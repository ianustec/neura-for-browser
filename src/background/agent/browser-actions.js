import { dlog, dwarn } from '../debug-log.js';

const PREPARE_TIMEOUT_MS = 1500;
const ACTIVATE_SETTLE_MS = 80;

/** @type {Map<number, Promise<unknown>>} */
const captureQueues = new Map();

/**
 * Serialize captures per tab so prepare/restore refcounts stay ordered.
 * @template T
 * @param {number} tabId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function enqueueCapture(tabId, fn) {
  const prev = captureQueues.get(tabId) || Promise.resolve();
  const next = prev.then(fn, fn);
  captureQueues.set(
    tabId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * @param {number} tabId
 * @param {'neura:capturePrepare'|'neura:captureRestore'} type
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string }>}
 */
function sendCaptureMessage(tabId, type, timeoutMs = PREPARE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, skipped: true, error: 'timeout' });
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          finish({ ok: false, skipped: true, error: err.message || String(err) });
          return;
        }
        if (resp?.ok) {
          finish({ ok: true });
          return;
        }
        finish({
          ok: false,
          skipped: true,
          error: resp?.error || 'no response',
        });
      });
    } catch (e) {
      finish({ ok: false, skipped: true, error: String(e?.message || e) });
    }
  });
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Capture the visible viewport of a specific tab without Neura UI overlay.
 * Hides the in-page host, restores full-bleed layout, captures via windowId, then restores.
 *
 * @param {number} tabId
 * @param {{ format?: 'png' | 'jpeg', quality?: number }} [opts]
 * @returns {Promise<{ ok: boolean, dataUrl?: string, message?: string, error?: string }>}
 */
export async function takeScreenshot(tabId, opts = {}) {
  if (tabId == null || Number.isNaN(Number(tabId))) {
    return { ok: false, error: 'Missing tabId for screenshot' };
  }
  const id = Number(tabId);
  return enqueueCapture(id, () => captureTabViewport(id, opts));
}

/**
 * @param {number} tabId
 * @param {{ format?: 'png' | 'jpeg', quality?: number }} [opts]
 * @returns {Promise<{ ok: boolean, dataUrl?: string, message?: string, error?: string }>}
 */
async function captureTabViewport(tabId, opts = {}) {
  const { format = 'png', quality } = opts;
  /** @type {chrome.tabs.CaptureVisibleTabOptions} */
  const options = { format };
  if (format === 'jpeg' && quality != null) options.quality = quality;

  let prepared = false;
  /** @type {string|null} */
  let prepError = null;
  try {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      return { ok: false, error: `Tab not found: ${e?.message || e}` };
    }

    const windowId = tab.windowId;
    if (windowId == null) {
      return { ok: false, error: 'Tab has no windowId' };
    }

    dlog('screenshot', 'start', {
      tabId,
      windowId,
      active: !!tab.active,
      url: String(tab.url || '').slice(0, 120),
      format,
    });

    if (!tab.active) {
      dlog('screenshot', 'activating tab', { tabId, windowId });
      await chrome.tabs.update(tabId, { active: true });
      await sleep(ACTIVATE_SETTLE_MS);
    }

    const prep = await sendCaptureMessage(tabId, 'neura:capturePrepare');
    prepared = !!prep.ok;
    prepError = prep.ok ? null : prep.error || 'unknown';
    if (prepared) {
      dlog('screenshot', 'prepare ok', { tabId });
    } else {
      dwarn('screenshot', 'prepare skipped; capturing with UI possibly visible', {
        tabId,
        error: prepError,
      });
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, options);
    dlog('screenshot', 'captured', {
      tabId,
      windowId,
      prepared,
      dataUrlLen: dataUrl ? String(dataUrl).length : 0,
    });
    return {
      ok: true,
      dataUrl,
      message: `${format.toUpperCase()} screenshot captured`,
    };
  } catch (e) {
    dwarn('screenshot', 'failed', { tabId, error: String(e?.message || e) });
    return { ok: false, error: String(e.message || e) };
  } finally {
    // Restore when prepare succeeded, or timed out (content may still have hidden UI).
    const shouldRestore = prepared || prepError === 'timeout';
    if (shouldRestore) {
      const rest = await sendCaptureMessage(tabId, 'neura:captureRestore');
      if (!rest.ok) {
        dwarn('screenshot', 'restore failed', { tabId, error: rest.error });
      } else {
        dlog('screenshot', 'restore ok', { tabId, prepared });
      }
    }
  }
}

/**
 * Lightweight JPEG frame for automatic agent vision (injected as image_url).
 * @param {number} tabId
 */
export async function captureVisionFrame(tabId) {
  return takeScreenshot(tabId, { format: 'jpeg', quality: 70 });
}

/**
 * @param {{ url: string, active?: boolean }} args
 */
export async function openNewTab(args) {
  try {
    const tab = await chrome.tabs.create({
      url: args.url,
      active: args.active !== false,
    });
    return { ok: true, tabId: tab.id, message: 'Tab opened' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * @param {{ url: string, filename?: string }} args
 */
export async function downloadFile(args) {
  try {
    const id = await chrome.downloads.download({
      url: args.url,
      filename: args.filename || undefined,
      saveAs: false,
    });
    return { ok: true, downloadId: id, message: 'Download started' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * @param {number} tabId
 * @param {string} url
 */
export async function navigateTab(tabId, url) {
  try {
    // Register before update so we never miss the complete event.
    const loadedPromise = waitForTabComplete(tabId, 30000, { requireEvent: true });
    await chrome.tabs.update(tabId, { url });
    const loaded = await loadedPromise;
    let title = '';
    let finalUrl = url;
    try {
      const tab = await chrome.tabs.get(tabId);
      title = tab.title || '';
      finalUrl = tab.url || url;
    } catch {
      /* tab may be gone */
    }
    return {
      ok: true,
      url: finalUrl,
      title,
      message: loaded
        ? `Navigation complete: ${finalUrl}`
        : `Navigated to ${finalUrl} (load timeout; page may still be loading)`,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * Build a Google Maps directions URL (Maps URL API).
 * @param {{ origin?: string, destination?: string, travelmode?: string }} args
 */
export function buildMapsDirectionsUrl(args = {}) {
  const params = new URLSearchParams({ api: '1' });
  const origin = String(args.origin || '').trim();
  const destination = String(args.destination || '').trim();
  const travelmode = String(args.travelmode || 'driving').trim() || 'driving';
  if (origin) params.set('origin', origin);
  if (destination) params.set('destination', destination);
  params.set('travelmode', travelmode);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * @param {number} tabId
 * @param {number} [timeoutMs]
 * @param {{ requireEvent?: boolean }} [opts] If requireEvent, do not resolve on current complete (use after navigation).
 * @returns {Promise<boolean>} true if complete, false on timeout
 */
export function waitForTabComplete(tabId, timeoutMs = 30000, opts = {}) {
  const requireEvent = !!opts.requireEvent;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') finish(true);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);

    if (!requireEvent) {
      chrome.tabs.get(tabId).then((tab) => {
        if (tab.status === 'complete') finish(true);
      }).catch(() => finish(false));
    }
  });
}

/**
 * Poll until the top-frame content script answers agent_exec (or timeout).
 * @param {number} tabId
 * @param {number} [timeoutMs]
 */
export function waitForPageToolsReady(tabId, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tryOnce = () => {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'agent_exec', name: '__ping__', args: {}, agentSession: true },
        { frameId: 0 },
        (resp) => {
          const err = chrome.runtime.lastError;
          if (!err && resp) {
            resolve(true);
            return;
          }
          if (Date.now() - started >= timeoutMs) {
            resolve(false);
            return;
          }
          setTimeout(tryOnce, 250);
        },
      );
    };
    tryOnce();
  });
}
