/**
 * Persistent Socket.IO client toward Open WebUI (Conduit-style).
 * Enables server-side tool execution via session_id on /api/chat/completions.
 */
import { io } from '../vendor/socket.io.esm.min.js';
import { getEndpoints, WS_PATH } from './constants.js';
import { getToken } from './auth.js';

const CONNECT_TIMEOUT_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;

/** @type {import('socket.io-client').Socket | null} */
let socket = null;
/** @type {string | null} */
let connectedToken = null;
/** @type {ReturnType<typeof setInterval> | null} */
let heartbeatTimer = null;
/** @type {Set<(event: object) => void>} */
const chatEventHandlers = new Set();
/** @type {Set<(state: { connected: boolean, sessionId: string|null }) => void>} */
const connectionHandlers = new Set();
/** @type {Promise<void> | null} */
let connectPromise = null;

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket?.connected) {
      socket.emit('heartbeat', {});
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// NOTE (dedup investigation): `events` and `chat-events` are two distinct
// Open WebUI socket event names (the former is a general-purpose broadcast
// used for several event kinds, the latter is chat-completion-specific) — they are
// not expected to re-emit the exact same chat:completion payload twice. A
// content-based dedupe was evaluated here but rejected: during real token
// streaming, two genuinely different chunks can carry identical short text
// (e.g. a repeated space or common word) within a small time window, so a
// naive "same content within N ms" filter would silently drop real deltas —
// a worse regression than the duplication bug it would guard against. The
// actual duplication reported by users is caused by treating cumulative
// reasoning snapshots as deltas (fixed in stream-chat.js's
// `appendOrDiffReasoning`), which also self-heals against any exact
// duplicate delivery of the same cumulative payload, so no dispatch-level
// dedupe is needed here.
// `ack` is Socket.IO's acknowledgement callback. Open WebUI uses it as an RPC
// channel (`sio.call`) for the events it waits on — `execute:tool` above all —
// so it must reach the handlers: the server stays blocked until one answers.
function dispatchChatEvent(raw, ack) {
  const event = coerceEventMap(raw);
  if (!event) return;
  const respond = typeof ack === 'function' ? ack : null;
  for (const handler of chatEventHandlers) {
    try {
      handler(event, respond);
    } catch (e) {
      console.warn('Neura socket: chat event handler error', e);
    }
  }
}

/**
 * @param {boolean} connected
 * @param {string | null} sessionId
 */
function notifyConnectionChange(connected, sessionId) {
  for (const handler of connectionHandlers) {
    try {
      handler({ connected, sessionId });
    } catch (e) {
      console.warn('Neura socket: connection handler error', e);
    }
  }
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
function coerceEventMap(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return /** @type {Record<string, unknown>} */ (raw);
  }
  if (Array.isArray(raw) && raw.length > 0 && raw[0] && typeof raw[0] === 'object') {
    return /** @type {Record<string, unknown>} */ (raw[0]);
  }
  return null;
}

function wireSocketEvents(sock) {
  sock.off('events');
  sock.off('chat-events');
  sock.on('events', (raw, ack) => dispatchChatEvent(raw, ack));
  sock.on('chat-events', (raw, ack) => dispatchChatEvent(raw, ack));

  sock.off('connect');
  sock.on('connect', () => {
    const token = connectedToken;
    if (token) {
      sock.emit('user-join', { auth: { token } });
    }
    console.log('[Neura socket] connected, session_id=', sock.id);
    notifyConnectionChange(true, sock.id || null);
  });

  sock.off('disconnect');
  sock.on('disconnect', (reason) => {
    console.log('[Neura socket] disconnected:', reason);
    stopHeartbeat();
    notifyConnectionChange(false, null);
  });

  sock.off('connect_error');
  sock.on('connect_error', (err) => {
    console.warn('[Neura socket] connect_error:', err?.message || err);
  });
}

/**
 * Open (or refresh) the Socket.IO connection when authenticated.
 * @returns {Promise<void>}
 */
export async function connect() {
  const token = await getToken();
  if (!token) {
    disconnect();
    return;
  }

  if (socket?.connected && connectedToken === token) {
    return;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
      stopHeartbeat();
    }

    const { BASE_URL } = await getEndpoints();
    connectedToken = token;

    socket = io(BASE_URL, {
      path: WS_PATH,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: CONNECT_TIMEOUT_MS,
      auth: { token },
      extraHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });

    wireSocketEvents(socket);

    await new Promise((resolve, reject) => {
      if (!socket) {
        reject(new Error('Socket non inizializzato.'));
        return;
      }

      const onConnect = () => {
        cleanup();
        startHeartbeat();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err?.message || err)));
      };
      const cleanup = () => {
        socket?.off('connect', onConnect);
        socket?.off('connect_error', onError);
      };

      if (socket.connected) {
        onConnect();
        return;
      }

      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
    });
  })();

  try {
    await connectPromise;
  } finally {
    connectPromise = null;
  }
}

/**
 * Tear down the socket (e.g. on sign-out).
 */
export function disconnect() {
  stopHeartbeat();
  connectedToken = null;
  connectPromise = null;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/**
 * @returns {boolean}
 */
export function isConnected() {
  return !!socket?.connected;
}

/**
 * @returns {string | null}
 */
export function getSessionId() {
  return socket?.connected ? socket.id || null : null;
}

/**
 * Wait until the socket is connected and return session_id.
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
export async function waitUntilConnected(timeoutMs = DEFAULT_WAIT_TIMEOUT_MS) {
  const existing = getSessionId();
  if (existing) return existing;

  try {
    await connect();
  } catch (e) {
    throw new Error(
      'Connessione realtime al server non disponibile: impossibile eseguire i tool lato server (workspace/MCP). Verifica la connessione e riprova.',
    );
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sessionId = getSessionId();
    if (sessionId) return sessionId;
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(
    'Connessione realtime al server non disponibile: impossibile eseguire i tool lato server (workspace/MCP). Verifica la connessione e riprova.',
  );
}

/**
 * Subscribe to Open WebUI chat socket events (`events` / `chat-events`).
 * Handlers that serve an RPC-style event must call `ack` with their result.
 * @param {(event: object, ack: ((result: unknown) => void) | null) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onChatEvent(handler) {
  chatEventHandlers.add(handler);
  return () => chatEventHandlers.delete(handler);
}

/**
 * Observe connect/disconnect transitions. A reconnect means events may have been
 * missed while the socket was down, so consumers should re-check server state.
 * @param {(state: { connected: boolean, sessionId: string|null }) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onConnectionChange(handler) {
  connectionHandlers.add(handler);
  return () => connectionHandlers.delete(handler);
}

/**
 * Keep-alive hook: reconnect if session exists but socket is down.
 * Called from chrome.alarms.
 */
export async function ensureConnectedIfAuthenticated() {
  const token = await getToken();
  if (!token) return;
  if (isConnected()) return;
  try {
    await connect();
  } catch (e) {
    console.warn('[Neura socket] keepalive reconnect failed:', e?.message || e);
  }
}
