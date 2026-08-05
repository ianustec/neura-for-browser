import * as browserActions from './browser-actions.js';
import { registerConfirmResolver } from './agent-confirm.js';
import { classifyNavigateUrl } from './url-guard.js';
import { TOOL_META } from './tools-schema.js';

const SEND_TIMEOUT_MS = 30000;
const SEND_RETRIES = 3;

function isConnectionError(errMsg) {
  const s = String(errMsg || '');
  return (
    s.includes('Receiving end does not exist') ||
    s.includes('Could not establish connection') ||
    s.includes('message port closed')
  );
}

function sendPageOnce(tabId, name, args) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      resolve({ ok: false, error: 'Timeout: content script did not respond' });
    }, SEND_TIMEOUT_MS);
    chrome.tabs.sendMessage(
      tabId,
      { type: 'agent_exec', name, args, agentSession: true },
      { frameId: 0 },
      (resp) => {
        clearTimeout(t);
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (!resp?.ok) {
          resolve({ ok: false, error: resp?.error || 'unknown error' });
          return;
        }
        resolve({ ok: true, result: resp.result ?? {} });
      },
    );
  });
}

async function sendPage(tabId, name, args) {
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= SEND_RETRIES; attempt++) {
    const res = await sendPageOnce(tabId, name, args);
    if (res.ok) {
      return JSON.stringify(res.result ?? {});
    }
    lastError = res.error || lastError;
    console.warn(`[Neura agent] page tool ${name} attempt ${attempt}/${SEND_RETRIES} failed`, {
      args,
      error: lastError,
    });
    if (!isConnectionError(lastError) || attempt === SEND_RETRIES) break;
    await browserActions.waitForPageToolsReady(tabId, 10000);
  }
  console.warn(`[Neura agent] page tool ${name} failed after retries`, { args, error: lastError });
  return JSON.stringify({ error: lastError });
}

/**
 * After navigation, wait for load + content script so follow-up page tools work.
 * @param {number} tabId
 * @param {object} navResult
 */
async function finalizeNavigation(tabId, navResult) {
  if (!navResult?.ok) return navResult;
  const toolsReady = await browserActions.waitForPageToolsReady(tabId);
  try {
    const tab = await chrome.tabs.get(tabId);
    return {
      ...navResult,
      url: tab.url || navResult.url,
      title: tab.title || navResult.title || '',
      ready: true,
      toolsReady: !!toolsReady,
      hint: 'Page is ready. Use read_dom_snapshot (or other page tools) before answering the user about this page.',
    };
  } catch {
    return { ...navResult, ready: false, toolsReady: !!toolsReady };
  }
}

/**
 * @param {(ev: object) => void} broadcast
 * @param {{ tool: string, args: object, summary?: string }} payload
 */
function waitForConfirm(broadcast, payload) {
  return new Promise((resolve) => {
    const confirmId =
      globalThis.crypto?.randomUUID?.() || `c_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
    registerConfirmResolver(confirmId, resolve);
    broadcast({
      type: 'agent:confirm',
      confirmId,
      tool: payload.tool,
      args: payload.args,
      summary: payload.summary || payload.tool,
    });
  });
}

/**
 * @param {string} name
 * @param {object} args
 * @param {number} tabId
 * @param {chrome.runtime.Port | null} port
 * @param {(ev: object) => void} [broadcast]
 */
export async function dispatchTool(name, args, tabId, port, broadcast) {
  const meta = TOOL_META[name];
  if (!meta) return JSON.stringify({ error: `unknown tool ${name}` });

  const send = typeof broadcast === 'function'
    ? broadcast
    : (ev) => {
        if (port) port.postMessage(ev);
      };

  if (name === 'navigate_same_origin') {
    // Prefer SW navigation so we can wait for load and avoid unload races.
    const tab = await chrome.tabs.get(tabId);
    const c = classifyNavigateUrl(args.url, tab.url || undefined);
    if (c.blocked) return JSON.stringify({ error: c.reason || 'blocked url' });
    if (!c.sameOrigin) {
      return JSON.stringify({
        error: 'URL is cross-origin; use navigate instead',
        url: c.href,
      });
    }
    const n = await browserActions.navigateTab(tabId, c.href);
    return JSON.stringify(await finalizeNavigation(tabId, n));
  }

  if (meta.kind === 'page') {
    return sendPage(tabId, name, args);
  }

  if (name === 'take_screenshot') {
    const r = await browserActions.takeScreenshot(tabId);
    if (r.ok && r.dataUrl) {
      // UI only — never put the data URL in the OWUI tool ack (huge + ambiguous).
      send({ type: 'agent:image', dataUrl: r.dataUrl });
      return JSON.stringify({
        ok: true,
        message: r.message || 'PNG screenshot captured',
        ...(r.width != null ? { width: r.width } : {}),
        ...(r.height != null ? { height: r.height } : {}),
      });
    }
    return JSON.stringify({
      ok: false,
      error: r.error || 'screenshot failed',
    });
  }

  if (name === 'open_maps_directions') {
    const destination = String(args.destination || '').trim();
    if (!destination) return JSON.stringify({ error: 'open_maps_directions requires destination' });
    const href = browserActions.buildMapsDirectionsUrl(args);
    const n = await browserActions.navigateTab(tabId, href);
    return JSON.stringify(await finalizeNavigation(tabId, n));
  }

  // Navigation tools run without an Allow/Deny prompt: browser navigation is
  // covered by the disclosure the user accepts when enabling the extension.
  if (name === 'navigate') {
    const tab = await chrome.tabs.get(tabId);
    const base = tab.url || '';
    const c = classifyNavigateUrl(args.url, base);
    if (c.blocked) return JSON.stringify({ error: c.reason || 'blocked url' });
    const n = await browserActions.navigateTab(tabId, c.href);
    return JSON.stringify(await finalizeNavigation(tabId, n));
  }

  if (name === 'open_new_tab') {
    const tab = await chrome.tabs.get(tabId);
    const c = classifyNavigateUrl(args.url, tab.url || undefined);
    if (c.blocked) return JSON.stringify({ error: c.reason || 'blocked url' });
    const r = await browserActions.openNewTab({ url: c.href, active: args.active });
    return JSON.stringify(r);
  }

  if (name === 'download_file') {
    const tab = await chrome.tabs.get(tabId);
    const c = classifyNavigateUrl(args.url, tab.url || undefined);
    if (c.blocked) return JSON.stringify({ error: c.reason || 'blocked url' });
    const ok = await waitForConfirm(send, {
      tool: 'download_file',
      args,
      summary: `Download file from ${c.href}`,
    });
    if (!ok) return JSON.stringify({ error: 'user denied download' });
    const r = await browserActions.downloadFile({ url: c.href, filename: args.filename });
    return JSON.stringify(r);
  }

  return JSON.stringify({ error: `unhandled browser tool ${name}` });
}
