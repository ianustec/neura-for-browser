/**
 * The extra that agent mode adds to a normal chat: browser automation.
 *
 * Open WebUI runs the turn exactly as it does for any chat — it resolves
 * `tool_ids`, executes workspace/MCP and built-in tools itself, and streams the
 * result. The browser tools are declared alongside them as a *direct* tool
 * server, which is Open WebUI's own mechanism for tools the client owns: when
 * the model calls one, the server does not execute it but asks the caller over
 * the socket (`execute:tool`) and waits for the answer through the Socket.IO
 * acknowledgement.
 *
 * So the extension never takes over the turn: it only answers the one question
 * the server cannot answer by itself, "what happened in the user's browser?".
 */
import { NEURA_AGENT_TOOLS, isBrowserToolName } from './tools-schema.js';
import { dispatchTool } from './dispatcher.js';
import { getAgentAborted } from './agent-abort.js';
import { onChatEvent } from '../socket-service.js';
import { dlog, dwarn } from '../debug-log.js';

/**
 * Marks the tool server as ours in the `execute:tool` payload the server sends
 * back (it echoes the whole server object), so a request coming from any other
 * tool server configured on the account is never mistaken for a browser tool.
 */
const BROWSER_TOOL_SERVER_URL = 'neura-extension://browser-tools';

/** @type {Map<string, { tabId: number, broadcast: (ev: object) => void, downloadedUrls: Set<string> }>} */
const sessions = new Map();
/** @type {(() => void) | null} */
let unsubscribe = null;

/**
 * Open WebUI reads `specs` as the bare function specs (name, description,
 * parameters) and wraps each one itself.
 * @returns {object[]}
 */
function browserToolSpecs() {
  return NEURA_AGENT_TOOLS.map((tool) => tool?.function).filter(
    (spec) => spec && isBrowserToolName(spec.name),
  );
}

/**
 * The `tool_servers` entry to send with the completion request.
 * @returns {object}
 */
export function buildBrowserToolServer() {
  return {
    url: BROWSER_TOOL_SERVER_URL,
    specs: browserToolSpecs(),
  };
}

/**
 * @param {string} chatId
 * @param {string} messageId
 * @returns {string}
 */
function sessionKey(chatId, messageId) {
  return `${chatId || ''}|${messageId || ''}`;
}

function ensureSubscribed() {
  if (unsubscribe) return;
  unsubscribe = onChatEvent(handleSocketEvent);
}

/**
 * Declare that this turn may run browser tools. Registered before the request is
 * sent, so an `execute:tool` cannot arrive before we can serve it.
 *
 * @param {object} opts
 * @param {string} opts.chatId Open WebUI chat id sent with the request
 * @param {string} opts.messageId assistant message id sent as `id`
 * @param {number} opts.tabId tab the automation acts on
 * @param {(ev: object) => void} opts.broadcast turn sink (tool progress, confirms)
 * @returns {() => void} call when the turn ends
 */
export function openBrowserToolSession({ chatId, messageId, tabId, broadcast }) {
  ensureSubscribed();
  const key = sessionKey(chatId, messageId);
  sessions.set(key, {
    tabId,
    broadcast: typeof broadcast === 'function' ? broadcast : () => {},
    // download_file writes to the user's disk and returns no content, so a model
    // retrying it must not save the same URL over and over within one turn.
    downloadedUrls: new Set(),
  });
  dlog('browser-tools', 'session open', { chatId, messageId, tabId });
  return () => {
    sessions.delete(key);
    dlog('browser-tools', 'session closed', { chatId, messageId });
  };
}

/**
 * @param {object} event
 * @param {((result: unknown) => void) | null} ack
 */
function handleSocketEvent(event, ack) {
  if (!ack) return;
  const type = event?.data?.type;
  if (type !== 'execute:tool') return;

  const data = event.data?.data;
  if (!data || typeof data !== 'object') return;
  // Not ours: another tool server on the account owns it. Staying silent is the
  // only correct answer — but past this point we must always reply, because the
  // server blocks on the acknowledgement and a timeout also costs it our session.
  if (String(data.server?.url || '') !== BROWSER_TOOL_SERVER_URL) return;

  const name = String(data.name || '');
  if (!isBrowserToolName(name)) {
    ack({ error: `Unknown browser tool "${name}".` });
    return;
  }

  const chatId = event.chat_id?.toString?.() || '';
  const messageId = event.message_id?.toString?.() || '';
  const session = sessions.get(sessionKey(chatId, messageId));
  if (!session) {
    // Another tab's turn, or a turn that has already ended: answering would run
    // an automation nobody is waiting for.
    ack({ error: 'No browser automation session is active for this message.' });
    return;
  }

  runBrowserTool(session, name, data.params, ack).catch((e) => {
    dwarn('browser-tools', 'tool failed', { name, error: String(e?.message || e) });
    ack({ error: String(e?.message || e) });
  });
}

/**
 * @param {{ tabId: number, broadcast: (ev: object) => void, downloadedUrls: Set<string> }} session
 * @param {string} name
 * @param {unknown} rawParams
 * @param {(result: unknown) => void} ack
 */
async function runBrowserTool(session, name, rawParams, ack) {
  const params = rawParams && typeof rawParams === 'object' ? rawParams : {};

  if (getAgentAborted()) {
    ack({ error: 'Browser automation stopped by the user.' });
    return;
  }

  const url = typeof params.url === 'string' ? params.url : '';
  if (name === 'download_file' && url && session.downloadedUrls.has(url)) {
    ack({
      ok: true,
      skipped: true,
      message:
        'This URL was already downloaded earlier in this turn; the file is on the user\'s disk. ' +
        'download_file only saves files for the user — it never returns file content.',
    });
    return;
  }

  session.broadcast({ type: 'agent:call_start', name });
  dlog('browser-tools', 'execute', { name, tabId: session.tabId });

  let raw;
  try {
    raw = await dispatchTool(name, params, session.tabId, null, session.broadcast);
    if (name === 'download_file' && url) session.downloadedUrls.add(url);
  } finally {
    session.broadcast({ type: 'agent:call_end', name, ok: true });
  }

  // dispatchTool answers with a JSON string; hand the server the object so it
  // reaches the model the same way any other tool result does.
  let result = raw;
  if (typeof raw === 'string') {
    try {
      result = JSON.parse(raw);
    } catch {
      result = { result: raw };
    }
  }
  ack(result ?? {});
}
