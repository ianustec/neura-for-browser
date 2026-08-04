// Active turn registry living in the service worker memory and mirrored to
// chrome.storage.local. Used to survive content-script re-injection during
// page navigations and (best-effort) service worker restarts.

const KEY_PREFIX = 'turn:';
const SNAPSHOT_DEBOUNCE_MS = 250;
const PARTIAL_CAP = 500 * 1024;
const EVENT_BUFFER_CAP = 400;
const IMAGE_PLACEHOLDER_THRESHOLD = 200 * 1024;
const TTL_MS = 60 * 60 * 1000;

/** @type {Map<number, TurnState>} */
const turns = new Map();

/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const pendingWrites = new Map();

function newTurnId() {
  return globalThis.crypto?.randomUUID?.() || `t_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

function clampPartial(s) {
  if (!s) return '';
  if (s.length <= PARTIAL_CAP) return s;
  return s.slice(0, PARTIAL_CAP) + '\n\n[...troncato per dimensioni...]';
}

function isHeavyImage(ev) {
  return ev && ev.type === 'agent:image' && typeof ev.dataUrl === 'string' && ev.dataUrl.length > IMAGE_PLACEHOLDER_THRESHOLD;
}

function lightCloneEvent(ev) {
  if (!isHeavyImage(ev)) return ev;
  return { type: 'agent:image', placeholder: true, ts: ev.ts };
}

function persistSerializable(turn) {
  return {
    turnId: turn.turnId,
    tabId: turn.tabId,
    originalUrl: turn.originalUrl,
    sessionKey: turn.sessionKey,
    chatId: turn.chatId || null,
    assistantMessageId: turn.assistantMessageId || null,
    owuiChatId: turn.owuiChatId || null,
    taskIds: Array.isArray(turn.taskIds) ? turn.taskIds : [],
    model: turn.model,
    agentMode: turn.agentMode,
    partialContent: clampPartial(turn.partialContent),
    partialReasoning: clampPartial(turn.partialReasoning || ''),
    finalText: clampPartial(turn.finalText),
    agentLog: turn.agentLog.map(lightCloneEvent),
    phase: turn.phase,
    phaseExtra: turn.phaseExtra,
    endReason: turn.endReason || null,
    lastUpdate: turn.lastUpdate,
    createdAt: turn.createdAt,
  };
}

function scheduleSnapshot(turn) {
  if (!turn) return;
  turn.lastUpdate = Date.now();
  const tabId = turn.tabId;
  if (pendingWrites.has(tabId)) return;
  const handle = setTimeout(() => {
    pendingWrites.delete(tabId);
    flushSnapshot(turn).catch((e) => console.warn('Neura: turn snapshot failed', e));
  }, SNAPSHOT_DEBOUNCE_MS);
  pendingWrites.set(tabId, handle);
}

async function flushSnapshot(turn) {
  if (!turn) return;
  const key = KEY_PREFIX + turn.tabId;
  await chrome.storage.local.set({ [key]: persistSerializable(turn) });
}

async function flushSnapshotImmediate(turn) {
  if (!turn) return;
  const handle = pendingWrites.get(turn.tabId);
  if (handle) {
    clearTimeout(handle);
    pendingWrites.delete(turn.tabId);
  }
  await flushSnapshot(turn);
}

function pushBuffer(turn, ev) {
  if (!turn) return;
  if (turn.attachedPort) return;
  const buf = turn.eventBuffer;
    if (buf.length >= EVENT_BUFFER_CAP) {
    let aggregated = false;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].type === ev.type && (ev.type === 'chunk' || ev.type === 'reasoning')) {
        buf[i].content += ev.content || '';
        aggregated = true;
        break;
      }
    }
    if (!aggregated) buf.shift();
    if (ev.type !== 'chunk' && ev.type !== 'reasoning') buf.push(lightCloneEvent(ev));
  } else {
    buf.push(lightCloneEvent(ev));
  }
}

export function beginTurn(tabId, init) {
  const existing = turns.get(tabId);
  if (existing && !isTerminalPhase(existing.phase)) {
    existing.endReason = 'replaced';
    existing.phase = 'aborted';
    flushSnapshotImmediate(existing).catch(() => {});
  }
  const now = Date.now();
  const turn = {
    turnId: init.turnId || newTurnId(),
    tabId,
    originalUrl: init.originalUrl || '',
    sessionKey: init.sessionKey || '',
    chatId: init.chatId || null,
    assistantMessageId: init.assistantMessageId || null,
    // Open WebUI's own identity for this turn: the chat id it registered the
    // task under and the task ids it returned. Needed to ask the server what is
    // still running after a service worker restart.
    owuiChatId: init.owuiChatId || null,
    taskIds: [],
    model: init.model || '',
    agentMode: !!init.agentMode,
    partialContent: '',
    partialReasoning: '',
    finalText: '',
    agentLog: [],
    phase: 'streaming',
    phaseExtra: null,
    endReason: null,
    attachedPort: init.port || null,
    eventBuffer: [],
    createdAt: now,
    lastUpdate: now,
  };
  turns.set(tabId, turn);
  scheduleSnapshot(turn);
  return turn;
}

export function getTurn(tabId) {
  return turns.get(tabId) || null;
}

export function getActiveTurnForTab(tabId) {
  const t = turns.get(tabId);
  if (!t) return null;
  if (isTerminalPhase(t.phase)) return null;
  return t;
}

export function isTerminalPhase(phase) {
  return phase === 'done' || phase === 'aborted' || phase === 'error';
}

export function updatePartial(turn, delta) {
  if (!turn || !delta) return;
  const wasEmpty = !turn.partialContent;
  turn.partialContent = clampPartial((turn.partialContent || '') + delta);
  if (wasEmpty) {
    flushSnapshotImmediate(turn).catch(() => {});
  } else {
    scheduleSnapshot(turn);
  }
}

export function appendAgentEvent(turn, ev) {
  if (!turn) return;
  const stamped = { ...ev, ts: ev.ts || Date.now() };
  turn.agentLog.push(stamped);
  if (turn.agentLog.length > 200) turn.agentLog.shift();
  scheduleSnapshot(turn);
}

export function setPhase(turn, phase, extra) {
  if (!turn) return;
  turn.phase = phase;
  turn.phaseExtra = extra || null;
  if (isTerminalPhase(phase)) {
    flushSnapshotImmediate(turn).catch(() => {});
  } else {
    scheduleSnapshot(turn);
  }
}

export function endTurn(turn, reason, extra) {
  if (!turn) return;
  if (isTerminalPhase(turn.phase) && turn.endReason) return;
  turn.phase = reason === 'done' ? 'done' : reason === 'error' ? 'error' : 'aborted';
  turn.endReason = reason || 'aborted';
  if (extra && extra.finalText) turn.finalText = clampPartial(extra.finalText);
  flushSnapshotImmediate(turn).catch(() => {});
}

/**
 * Record the server-side identity of the turn as soon as Open WebUI reports it.
 * @param {object} turn
 * @param {{ owuiChatId?: string|null, taskIds?: string[] }} info
 */
export function setServerTask(turn, info) {
  if (!turn) return;
  if (info?.owuiChatId !== undefined) turn.owuiChatId = info.owuiChatId || null;
  if (Array.isArray(info?.taskIds)) turn.taskIds = info.taskIds.filter(Boolean);
  flushSnapshotImmediate(turn).catch(() => {});
}

/**
 * Put a persisted snapshot back into the in-memory registry after a service
 * worker restart, so the content script can rejoin the turn it was following.
 * @param {object} snap
 * @returns {object}
 */
export function rehydrateTurn(snap) {
  const turn = {
    ...snap,
    agentLog: Array.isArray(snap.agentLog) ? snap.agentLog.slice() : [],
    taskIds: Array.isArray(snap.taskIds) ? snap.taskIds.slice() : [],
    attachedPort: null,
    eventBuffer: [],
    lastUpdate: Date.now(),
  };
  turns.set(turn.tabId, turn);
  return turn;
}

/**
 * @returns {Promise<object[]>} persisted snapshots of turns that had not ended
 */
export async function readUnfinishedSnapshots() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  /** @type {object[]} */
  const snapshots = [];
  for (const key of Object.keys(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const snap = all[key];
    if (!snap || typeof snap !== 'object') continue;
    if (now - (snap.lastUpdate || 0) > TTL_MS) continue;
    if (isTerminalPhase(snap.phase)) continue;
    snapshots.push(snap);
  }
  return snapshots;
}

/**
 * @param {object} snap
 * @param {string} phase
 * @param {string} endReason
 */
export async function markSnapshotEnded(snap, phase, endReason) {
  if (!snap?.tabId && snap?.tabId !== 0) return;
  const key = KEY_PREFIX + snap.tabId;
  const next = { ...snap, phase, endReason, lastUpdate: Date.now() };
  await chrome.storage.local.set({ [key]: next });
}

export function attachPort(turn, port) {
  if (!turn) return;
  turn.attachedPort = port || null;
  scheduleSnapshot(turn);
}

export function detachPort(turn) {
  if (!turn) return;
  turn.attachedPort = null;
  scheduleSnapshot(turn);
}

export function updatePartialReasoning(turn, delta) {
  if (!turn || !delta) return;
  turn.partialReasoning = clampPartial((turn.partialReasoning || '') + delta);
  scheduleSnapshot(turn);
}

export function broadcast(turn, event) {
  if (!turn) return;
  if (event.type === 'chunk' && typeof event.content === 'string') {
    updatePartial(turn, event.content);
  }
  if (event.type === 'reasoning' && typeof event.content === 'string') {
    updatePartialReasoning(turn, event.content);
  }
  if (event.type === 'agent:image' || event.type === 'agent:iteration' || event.type === 'agent:call_start' || event.type === 'agent:call_end' || event.type === 'agent:confirm') {
    appendAgentEvent(turn, event);
  }
  if (event.type === 'status') {
    turn.lastStatus = event.done ? null : { description: event.description, hidden: !!event.hidden };
    scheduleSnapshot(turn);
  }
  const payload = {
    ...event,
    turnId: turn.turnId,
    chatId: turn.chatId || null,
  };
  const port = turn.attachedPort;
  if (port) {
    try {
      port.postMessage(payload);
      return;
    } catch {
      turn.attachedPort = null;
    }
  }
  pushBuffer(turn, payload);
}

export function drainBufferTo(turn, port) {
  if (!turn || !port) return;
  const buf = turn.eventBuffer;
  turn.eventBuffer = [];
  for (const ev of buf) {
    // partialContent/partialReasoning already include every buffered 'chunk'/
    // 'reasoning' event (see broadcast() below) and are painted in full from
    // the rejoin snapshot before this drain runs. Replaying them here would
    // re-append the same text on top of what was just painted, duplicating it.
    if (ev.type === 'chunk' || ev.type === 'reasoning') continue;
    try {
      port.postMessage(ev);
    } catch {
      turn.eventBuffer = buf.slice(buf.indexOf(ev));
      return;
    }
  }
}

export function buildRejoinSnapshot(turn) {
  if (!turn) return null;
  return {
    turnId: turn.turnId,
    phase: turn.phase,
    phaseExtra: turn.phaseExtra,
    agentMode: turn.agentMode,
    chatId: turn.chatId || null,
    assistantMessageId: turn.assistantMessageId || null,
    partialContent: turn.partialContent || '',
    partialReasoning: turn.partialReasoning || '',
    finalText: turn.finalText || '',
    agentLog: turn.agentLog.slice(),
    lastStatus: turn.lastStatus || null,
    sessionKey: turn.sessionKey,
    originalUrl: turn.originalUrl,
  };
}

/**
 * Drop snapshots that are corrupt or past their TTL. Deciding the fate of turns
 * that were still running is not a storage concern: it depends on what the
 * server says is still running (see turn-recovery.js).
 */
export async function pruneInvalidTurns() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const toRemove = [];
  for (const key of Object.keys(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const snap = all[key];
    if (!snap || typeof snap !== 'object' || now - (snap.lastUpdate || 0) > TTL_MS) {
      toRemove.push(key);
    }
  }
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}

export async function pruneOldTurns(maxAgeMs = TTL_MS) {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const toRemove = [];
  for (const key of Object.keys(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const snap = all[key];
    if (!snap || now - (snap.lastUpdate || 0) > maxAgeMs) toRemove.push(key);
  }
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}

export function dropTurn(tabId) {
  const t = turns.get(tabId);
  if (t) turns.delete(tabId);
  const handle = pendingWrites.get(tabId);
  if (handle) {
    clearTimeout(handle);
    pendingWrites.delete(tabId);
  }
  chrome.storage.local.remove(KEY_PREFIX + tabId).catch(() => {});
}
