/**
 * Persistent consumer of Open WebUI's chat lifecycle over Socket.IO.
 *
 * Open WebUI drives a turn entirely from the server: it registers one task per
 * (chat_id, assistant message), streams `chat:completion` frames, emits exactly
 * one `done: true` once every tool loop has finished, then runs outlet filters,
 * title, tags and follow-ups, and finally reports `chat:active {active:false}`
 * when no task is left for the chat.
 *
 * This module mirrors that contract, so nothing here guesses:
 *
 * - one module-level socket subscription, never torn down between turns, with a
 *   registry keyed by assistant message id (events are broadcast to the whole
 *   `user:{id}` room, so every consumer filters by chat_id / message_id);
 * - the content promise settles on `done: true` (authoritative and complete) or
 *   on an explicit error / cancel event;
 * - the subscription stays alive past `done` so title, tags, follow-ups and
 *   outlet updates are received instead of polled for;
 * - whenever the socket goes quiet, the answer comes from the task registry
 *   (`GET /api/tasks/chat/{chat_id}`), never from a timer: tasks still listed
 *   means the server is still working — MCP reads legitimately take minutes.
 */
import { onChatEvent, onConnectionChange } from './socket-service.js';
import { getEndpoints } from './constants.js';
import { listChatTaskIds, stopChatTasks } from './owui-tasks.js';
import { getServerCapabilities } from './openwebui-config.js';
import {
  extractOutputText,
  finalizeToolCalls,
  forwardOwUiEvent,
  ingestCompletionPayload,
  ingestMessageContentEvent,
  setOwUiBaseUrl,
} from './stream-chat.js';
import { dlog, dwarn } from './debug-log.js';

/**
 * Grace before asking the registry once the message is complete, when the server
 * is known to emit `chat:active` (0.8.0+): the event normally arrives first, and
 * only after the tail tasks (title/tags/follow-ups) have run.
 */
const TAIL_WAIT_WITH_CHAT_ACTIVE_MS = 30_000;
/** Same, on servers without `chat:active`: the registry is the only signal. */
const TAIL_WAIT_WITHOUT_CHAT_ACTIVE_MS = 2_000;
/** Silence tolerated before asking the server what is still running. */
const IDLE_RECONCILE_MS = 20_000;
/** Consecutive indeterminate registry answers tolerated before failing loudly. */
const MAX_RECONCILE_FAILURES = 5;
/** Delay before confirming a cancellation against the registry. */
const ABORT_CONFIRM_MS = 1_500;

/** @type {Map<string, object>} */
const turnsByMessageId = new Map();
/** @type {Map<string, Set<string>>} */
const messageIdsByChatId = new Map();
/** @type {(() => void) | null} */
let unsubscribeSocket = null;

function ensureSubscribed() {
  if (unsubscribeSocket) return;
  unsubscribeSocket = onChatEvent(handleSocketEvent);
  onConnectionChange(({ connected }) => {
    if (!connected) return;
    // Events emitted while the socket was down are gone: ask the server.
    for (const turn of turnsByMessageId.values()) {
      scheduleReconcile(turn, 0, 'socket_reconnect');
    }
  });
}

/**
 * @param {object} turn
 */
function indexTurn(turn) {
  turnsByMessageId.set(turn.messageId, turn);
  if (turn.chatId) {
    let ids = messageIdsByChatId.get(turn.chatId);
    if (!ids) {
      ids = new Set();
      messageIdsByChatId.set(turn.chatId, ids);
    }
    ids.add(turn.messageId);
  }
}

/**
 * @param {object} turn
 */
function unindexTurn(turn) {
  turnsByMessageId.delete(turn.messageId);
  if (turn.chatId) {
    const ids = messageIdsByChatId.get(turn.chatId);
    if (ids) {
      ids.delete(turn.messageId);
      if (ids.size === 0) messageIdsByChatId.delete(turn.chatId);
    }
  }
}

/**
 * Split an Open WebUI socket envelope `{chat_id, message_id, data: {type, data}}`.
 *
 * `data` is returned verbatim because some events carry a bare value rather than
 * an object (`chat:title` is a string, `chat:tags` an array), while `payload` is
 * the object form the ingest helpers expect.
 * @param {object} event
 */
function parseEnvelope(event) {
  const chatId = event.chat_id?.toString?.() || '';
  const messageId = event.message_id?.toString?.() || '';
  const outer = event.data;

  if (outer && typeof outer === 'object' && !Array.isArray(outer) && outer.type) {
    const inner = /** @type {Record<string, unknown>} */ (outer).data;
    return {
      type: String(/** @type {Record<string, unknown>} */ (outer).type),
      data: inner,
      payload:
        inner && typeof inner === 'object' && !Array.isArray(inner)
          ? /** @type {object} */ (inner)
          : /** @type {object} */ (outer),
      chatId,
      messageId,
    };
  }

  if (event.type) {
    return {
      type: String(event.type),
      data: outer,
      payload: outer && typeof outer === 'object' ? /** @type {object} */ (outer) : null,
      chatId,
      messageId,
    };
  }

  return { type: '', data: null, payload: null, chatId, messageId };
}

/**
 * Events that describe the chat rather than one assistant message. Their
 * envelope carries whichever sibling task happened to emit them (with several
 * models, `chat:active {active:false}` comes from the task that finished last),
 * so they must be routed by chat id.
 */
const CHAT_SCOPED_EVENTS = new Set(['chat:active', 'chat:title', 'chat:tags']);

/**
 * Which registered turns an envelope belongs to.
 * @param {{ type: string, chatId: string, messageId: string }} envelope
 * @returns {object[]}
 */
function routeEnvelope({ type, chatId, messageId }) {
  if (CHAT_SCOPED_EVENTS.has(type)) {
    if (!chatId) return [];
    const ids = messageIdsByChatId.get(chatId);
    if (!ids || ids.size === 0) return [];
    return [...ids].map((id) => turnsByMessageId.get(id)).filter(Boolean);
  }

  // Everything else describes one assistant message: an unknown message id
  // belongs to another tab or another chat of the same user and must be ignored,
  // otherwise its content would leak into ours.
  if (!messageId) return [];
  const direct = turnsByMessageId.get(messageId);
  if (direct) return [direct];
  for (const turn of turnsByMessageId.values()) {
    if (turn.acceptsMessageId(messageId)) return [turn];
  }
  return [];
}

/**
 * @param {object} rawEvent
 */
function handleSocketEvent(rawEvent) {
  const event = rawEvent && typeof rawEvent === 'object' ? rawEvent : null;
  if (!event) return;
  if (turnsByMessageId.size === 0) return;

  const envelope = parseEnvelope(event);
  if (!envelope.type) return;

  for (const turn of routeEnvelope(envelope)) {
    if (turn.closed) continue;
    if (turn.chatId && envelope.chatId && envelope.chatId !== turn.chatId) continue;
    try {
      ingestForTurn(turn, envelope);
    } catch (e) {
      dwarn('turn-channel', 'event handling failed', {
        type: envelope.type,
        messageId: turn.messageId,
        error: String(e?.message || e),
      });
    }
  }
}

/**
 * Follow-up suggestions have been shipped under several payload shapes.
 * @param {unknown} payload
 * @returns {string[]}
 */
function extractFollowUpItems(payload) {
  if (!payload) return [];
  const raw =
    (Array.isArray(payload) && payload) ||
    payload.follow_ups ||
    payload.follow_up_completions ||
    payload.suggestions ||
    payload.items ||
    (Array.isArray(payload.data) && payload.data) ||
    [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? item : item?.text || item?.content || item?.title || ''))
    .map((s) => String(s || '').trim())
    .filter(Boolean);
}

/**
 * @param {object} turn
 * @param {{ type: string, data: unknown, payload: object|null, chatId: string, messageId: string }} envelope
 */
function ingestForTurn(turn, envelope) {
  const { type, data, payload } = envelope;
  turn.lastEventAt = Date.now();

  if (type === 'chat:message:error') {
    const msg =
      payload?.error?.content?.toString?.() ||
      payload?.error?.toString?.() ||
      payload?.message?.toString?.() ||
      'Errore durante la generazione della risposta.';
    turn.state.streamError = msg;
    turn.sink.broadcast({ type: 'stream_error', message: msg });
    settle(turn, new Error(msg));
    return;
  }

  if (type === 'chat:tasks:cancel') {
    dlog('turn-channel', 'server confirmed cancellation', { messageId: turn.messageId });
    settle(turn, abortError());
    closeTurn(turn, 'cancelled');
    return;
  }

  if (type === 'chat:active') {
    const active = !!(payload && typeof payload === 'object' ? payload.active : data);
    turn.notify({ type: 'chat_active', chatId: turn.chatId, active });
    if (!active) {
      if (!turn.postCompleted) {
        // Our task is not registered yet, so this reports the end of somebody
        // else's work on the same chat — every ephemeral turn of one browser
        // session shares `temporary:{sid}`.
        dlog('turn-channel', 'ignoring chat:active false received before our task existed', {
          messageId: turn.messageId,
          chatId: turn.chatId,
        });
        return;
      }
      if (!turn.messageDone) {
        // The event is chat-scoped, and a single `temporary:{sid}` chat carries
        // several turns (each agent step, plus its nested workspace queries), so
        // this may well be a sibling task ending. Only the registry knows whether
        // *our* task is among those that finished.
        dlog('turn-channel', 'chat:active false before our message completed — asking the registry', {
          messageId: turn.messageId,
          chatId: turn.chatId,
        });
        scheduleReconcile(turn, 0, 'chat_active_false');
        return;
      }
      dlog('turn-channel', 'chat:active false — server finished this chat', {
        messageId: turn.messageId,
        chatId: turn.chatId,
      });
      finishFromServer(turn, 'chat_active_false');
    }
    return;
  }

  if (type === 'chat:title') {
    const title = typeof data === 'string' ? data : String(payload?.title || '');
    if (title) turn.notify({ type: 'owui_title', chatId: turn.chatId, title });
    return;
  }

  if (type === 'chat:tags') {
    const tags = Array.isArray(data)
      ? data.map((t) => String(t || '')).filter(Boolean)
      : Array.isArray(payload?.tags)
        ? payload.tags.map((t) => String(t || '')).filter(Boolean)
        : [];
    turn.notify({ type: 'owui_tags', chatId: turn.chatId, tags });
    return;
  }

  if (type === 'chat:message:follow_ups') {
    const items = extractFollowUpItems(payload);
    if (items.length > 0) turn.notify({ type: 'owui_follow_ups', chatId: turn.chatId, items });
    return;
  }

  if (type === 'chat:outlet') {
    // Outlet filters may rewrite the final message; the server has already
    // persisted the result, so we only forward it for rendering.
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    if (messages.length > 0) turn.notify({ type: 'owui_outlet', chatId: turn.chatId, messages });
    return;
  }

  if (ingestMessageContentEvent(type, payload, turn.sink, turn.state)) return;

  if (type === 'chat:completion' && payload) {
    // An error rides along the normal completion frame; the server still closes
    // the turn afterwards, so record it and let `done` settle as usual.
    const errorText =
      payload.error?.content?.toString?.() ||
      (typeof payload.error === 'string' ? payload.error : '') ||
      payload.error?.message?.toString?.() ||
      '';
    if (errorText) {
      turn.state.streamError = errorText;
      turn.sink.broadcast({ type: 'stream_error', message: errorText });
    }

    if (payload.usage) {
      turn.state.usage = payload.usage;
      turn.sink.broadcast({ type: 'usage', data: payload.usage });
    }
    if (Array.isArray(payload.sources) && payload.sources.length > 0) {
      turn.state.hadSources = true;
      turn.sink.broadcast({ type: 'sources', items: payload.sources });
    }

    ingestCompletionPayload(payload, turn.sink, turn.state);

    if (payload.done === true) {
      onMessageDone(turn);
    }
    return;
  }

  if ((type === 'status' || type === 'event:status') && payload) {
    if (turn.sink.forwardStatus !== false) {
      turn.sink.broadcast({
        type: 'status',
        description: payload.description || payload.action || '',
        done: !!payload.done,
        hidden: !!payload.hidden,
      });
    }
    return;
  }

  if (payload) {
    forwardOwUiEvent({ type, data: payload, ...payload }, turn.sink, turn.state);
  }
}

/**
 * Open WebUI emits `done: true` exactly once per assistant message, after every
 * tool iteration has completed, with the full `output` array. It is therefore
 * safe — and required, to keep the composer responsive — to hand the content
 * back right away. The subscription lives on for the server's tail work.
 * @param {object} turn
 */
function onMessageDone(turn) {
  if (turn.messageDone) return;
  turn.messageDone = true;
  dlog('turn-channel', 'message complete', {
    messageId: turn.messageId,
    chars: (turn.state.fullContent || '').length,
    hadToolExecution: !!turn.state.hadToolExecution,
    files: (turn.state.fileItems || []).length,
  });
  settle(turn, null);
  scheduleReconcile(turn, turn.tailWaitMs, 'after_done');
}

/**
 * @returns {DOMException}
 */
function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

/**
 * Hand the accumulated content to the caller. The turn stays registered.
 * @param {object} turn
 * @param {Error|null} err
 */
function settle(turn, err) {
  if (turn.settled) return;
  turn.settled = true;
  if (turn.signal && turn.onAbort) turn.signal.removeEventListener('abort', turn.onAbort);
  if (err) {
    turn.reject(err);
    return;
  }
  const state = turn.state;
  const fullContent = state.fullContent || extractOutputText(state.outputItems);
  turn.resolve({
    fullContent,
    fullReasoning: state.fullReasoning || '',
    finishReason: state.finishReason,
    toolCalls: finalizeToolCalls(state.toolAcc),
    hadToolExecution: state.hadToolExecution,
    hadSources: state.hadSources,
    hadFiles: !!state.hadFiles,
    fileItems: state.fileItems || [],
    usage: state.usage,
    streamError: state.streamError,
    outputItems: state.outputItems || [],
  });
}

/**
 * The server says nothing is running for us any more.
 * @param {object} turn
 * @param {string} reason
 */
function finishFromServer(turn, reason) {
  if (!turn.settled) {
    if (turn.abortRequested) settle(turn, abortError());
    else settle(turn, null);
  }
  closeTurn(turn, reason);
}

/**
 * @param {object} turn
 * @param {string} reason
 */
function closeTurn(turn, reason) {
  if (turn.closed) return;
  turn.closed = true;
  clearReconcile(turn);
  unindexTurn(turn);
  if (turn.signal && turn.onAbort) turn.signal.removeEventListener('abort', turn.onAbort);
  if (!turn.settled) settle(turn, null);
  dlog('turn-channel', 'turn closed', { messageId: turn.messageId, reason });
  // Reported out-of-band only: by now the page's streaming port for this turn is
  // normally closed, and buffering a terminal event for a future rejoin would
  // just replay it against an unrelated turn.
  if (!turn.discarded) {
    turn.notify({ type: 'turn_closed', chatId: turn.chatId, reason });
  }
}

/**
 * @param {object} turn
 */
function clearReconcile(turn) {
  if (turn.reconcileTimer) {
    clearTimeout(turn.reconcileTimer);
    turn.reconcileTimer = null;
  }
}

/**
 * Timers here never decide the outcome: they only schedule a question to the
 * server's task registry, whose answer is authoritative.
 * @param {object} turn
 * @param {number} delayMs
 * @param {string} reason
 */
function scheduleReconcile(turn, delayMs, reason) {
  if (turn.closed || !turn.chatId || !turn.postCompleted) return;
  clearReconcile(turn);
  turn.reconcileTimer = setTimeout(() => {
    turn.reconcileTimer = null;
    reconcile(turn, reason).catch((e) =>
      dwarn('turn-channel', 'reconcile threw', { messageId: turn.messageId, error: String(e?.message || e) }),
    );
  }, Math.max(0, delayMs));
}

/**
 * @param {object} turn
 * @param {string} reason
 */
async function reconcile(turn, reason) {
  if (turn.closed) return;

  // While frames are still arriving there is nothing to ask about.
  if (reason === 'idle' || reason === 'still_running') {
    const quietFor = Date.now() - turn.lastEventAt;
    if (quietFor < IDLE_RECONCILE_MS) {
      scheduleReconcile(turn, IDLE_RECONCILE_MS - quietFor, 'idle');
      return;
    }
  }

  const taskIds = await listChatTaskIds(turn.chatId);
  if (turn.closed) return;

  if (taskIds === null) {
    turn.reconcileFailures += 1;
    dwarn('turn-channel', 'task registry unavailable', {
      messageId: turn.messageId,
      failures: turn.reconcileFailures,
      reason,
    });
    if (turn.reconcileFailures >= MAX_RECONCILE_FAILURES) {
      if (!turn.settled) {
        settle(
          turn,
          new Error(
            'Impossibile verificare lo stato della generazione sul server (task registry non raggiungibile).',
          ),
        );
      }
      closeTurn(turn, 'registry_unreachable');
      return;
    }
    scheduleReconcile(turn, IDLE_RECONCILE_MS, 'registry_retry');
    return;
  }

  turn.reconcileFailures = 0;
  const ours = turn.taskIds.filter(Boolean);
  // Knowing our own task ids makes this precise even when several turns share a
  // chat id (every `temporary:` chat of one browser session does).
  const stillRunning = ours.length > 0 ? ours.some((id) => taskIds.includes(id)) : taskIds.length > 0;

  if (stillRunning) {
    dlog('turn-channel', 'server still working', {
      messageId: turn.messageId,
      reason,
      running: taskIds.length,
    });
    scheduleReconcile(turn, IDLE_RECONCILE_MS, 'still_running');
    return;
  }

  dlog('turn-channel', 'task registry empty for this turn', { messageId: turn.messageId, reason });
  finishFromServer(turn, `registry_empty:${reason}`);
}

/**
 * Ask the server to cancel, then wait for it to confirm — exactly like the web
 * client, which keeps showing the generation until `chat:tasks:cancel` or
 * `chat:active {active:false}` arrives.
 * @param {object} turn
 */
async function requestAbort(turn) {
  if (turn.closed || turn.abortRequested) return;
  if (turn.messageDone || turn.settled) {
    // The answer is already complete: the server's remaining work (outlet
    // filters, title, tags, follow-ups) is not something to cancel.
    dlog('turn-channel', 'ignoring cancellation of a completed message', {
      messageId: turn.messageId,
    });
    return;
  }
  turn.abortRequested = true;
  dlog('turn-channel', 'requesting cancellation', {
    messageId: turn.messageId,
    chatId: turn.chatId,
    taskIds: turn.taskIds.length,
  });

  const accepted = await stopChatTasks({ chatId: turn.chatId, taskIds: turn.taskIds });
  if (turn.closed) return;

  if (!accepted) {
    // No endpoint accepted the request, so no server event will confirm it.
    dwarn('turn-channel', 'server did not accept cancellation', { messageId: turn.messageId });
    settle(turn, abortError());
    closeTurn(turn, 'abort_unconfirmed');
    return;
  }

  scheduleReconcile(turn, ABORT_CONFIRM_MS, 'abort_confirm');
}

/**
 * Register a consumer for one assistant message before the completion request is
 * sent, so no event can be lost in the gap between the HTTP response and the
 * subscription.
 *
 * @param {object} opts
 * @param {string} opts.messageId assistant message id sent as `id`
 * @param {string} [opts.chatId]
 * @param {string} [opts.userMessageId]
 * @param {AbortSignal} [opts.signal]
 * @param {(ev: object) => void} [opts.broadcast] streaming port sink
 * @param {(msg: object) => void} [opts.notify] out-of-band tab sink (survives port close)
 * @param {(chunk: string) => void} [opts.onPartial]
 * @param {boolean} [opts.forwardContentChunks]
 * @param {boolean} [opts.forwardStatus]
 * @returns {{ promise: Promise<object>, attachTaskIds: (ids: string[]) => void, adoptChatId: (id: string) => void, discard: () => void }}
 */
export function beginTurn({
  messageId,
  chatId = '',
  userMessageId = '',
  signal,
  broadcast,
  notify,
  onPartial,
  forwardContentChunks = true,
  forwardStatus = true,
}) {
  ensureSubscribed();
  getEndpoints()
    .then(({ BASE_URL }) => setOwUiBaseUrl(BASE_URL))
    .catch(() => {});

  const existing = turnsByMessageId.get(messageId);
  if (existing) closeTurn(existing, 'replaced');

  /** @type {(value: object) => void} */
  let resolve = () => {};
  /** @type {(err: Error) => void} */
  let reject = () => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const turn = {
    messageId: String(messageId || ''),
    userMessageId: String(userMessageId || ''),
    chatId: String(chatId || ''),
    taskIds: /** @type {string[]} */ ([]),
    resolve,
    reject,
    promise,
    settled: false,
    closed: false,
    discarded: false,
    messageDone: false,
    abortRequested: false,
    postCompleted: false,
    lastEventAt: Date.now(),
    reconcileTimer: /** @type {ReturnType<typeof setTimeout>|null} */ (null),
    reconcileFailures: 0,
    tailWaitMs: TAIL_WAIT_WITHOUT_CHAT_ACTIVE_MS,
    signal,
    onAbort: /** @type {(() => void)|null} */ (null),
    state: {
      fullContent: '',
      fullReasoning: '',
      finishReason: null,
      toolAcc: new Map(),
      hadToolExecution: false,
      hadSources: false,
      hadFiles: false,
      fileItems: /** @type {object[]} */ ([]),
      usage: null,
      streamError: null,
      outputItems: /** @type {object[]} */ ([]),
      sawOutputItems: false,
      sawMessageContent: false,
    },
    sink: {
      broadcast: (ev) => {
        if (typeof broadcast === 'function') broadcast(ev);
      },
      forwardContentChunks,
      forwardStatus,
      onPartial,
    },
    notify: (msg) => {
      if (typeof notify === 'function') notify(msg);
    },
    /** @param {string} id */
    acceptsMessageId(id) {
      const value = String(id || '');
      return value === this.messageId || (!!this.userMessageId && value === this.userMessageId);
    },
  };

  if (signal) {
    turn.onAbort = () => {
      requestAbort(turn).catch((e) =>
        dwarn('turn-channel', 'abort request failed', {
          messageId: turn.messageId,
          error: String(e?.message || e),
        }),
      );
    };
    if (signal.aborted) turn.onAbort();
    else signal.addEventListener('abort', turn.onAbort);
  }

  indexTurn(turn);

  // Prefer the event when the server is known to emit it; fall back to the
  // registry promptly on older servers where it does not exist.
  getServerCapabilities()
    .then((caps) => {
      turn.tailWaitMs =
        caps.chatActive === false ? TAIL_WAIT_WITHOUT_CHAT_ACTIVE_MS : TAIL_WAIT_WITH_CHAT_ACTIVE_MS;
    })
    .catch(() => {});

  return {
    promise,
    /** @param {string[]} ids */
    attachTaskIds(ids) {
      turn.taskIds = (Array.isArray(ids) ? ids : []).map((id) => String(id || '')).filter(Boolean);
      turn.postCompleted = true;
      if (turn.abortRequested) {
        // The user pressed stop while the request was still in flight.
        requestAbort(turn).catch(() => {});
        return;
      }
      scheduleReconcile(turn, IDLE_RECONCILE_MS, 'idle');
    },
    /** @param {string} id */
    adoptChatId(id) {
      const next = String(id || '').trim();
      if (!next || next === turn.chatId) return;
      unindexTurn(turn);
      turn.chatId = next;
      indexTurn(turn);
    },
    discard() {
      turn.discarded = true;
      closeTurn(turn, 'discarded');
    },
  };
}

/**
 * Cancel every registered turn of a chat (used by the UI stop button when the
 * turn is not reachable through its own AbortController).
 * @param {string} chatId
 * @returns {Promise<boolean>}
 */
export async function abortTurnsForChat(chatId) {
  const ids = messageIdsByChatId.get(String(chatId || ''));
  if (!ids || ids.size === 0) return false;
  const turns = [...ids].map((id) => turnsByMessageId.get(id)).filter(Boolean);
  await Promise.all(turns.map((turn) => requestAbort(turn)));
  return turns.length > 0;
}

/**
 * @returns {{ messageId: string, chatId: string, taskIds: string[], messageDone: boolean }[]}
 */
export function listActiveTurns() {
  return [...turnsByMessageId.values()].map((turn) => ({
    messageId: turn.messageId,
    chatId: turn.chatId,
    taskIds: [...turn.taskIds],
    messageDone: !!turn.messageDone,
  }));
}
