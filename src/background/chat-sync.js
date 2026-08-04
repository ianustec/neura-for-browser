import * as chatsApi from './chats-api.js';
import { buildChatBlob, parseChatBlob, getRemoteUpdatedAt, sanitizeHistoryContent } from './chat-blob.js';
import * as syncStore from './chat-sync-store.js';
import * as outbox from './outbox.js';
import { toMillis } from './timestamp-utils.js';
import { getToken } from './auth.js';

const INDEX_KEY = 'neuraLocalChatIndex';
const CHAT_KEY_PREFIX = 'neuraLocalChat:';

function chatKey(id) {
  return CHAT_KEY_PREFIX + id;
}

function makeLocalId() {
  return globalThis.crypto?.randomUUID?.() || `chat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function sortByUpdatedDesc(a, b) {
  return toMillis(b.updatedAt) - toMillis(a.updatedAt);
}

/**
 * OWUI web UI deadlocks when history.currentId points at a node missing `role`,
 * or when any node lacks the `parentId` key (`undefined !== null` → infinite Loading).
 * OWUI's own UserMessage.svelte also feeds `message.content` straight into
 * `<Markdown>` — a non-string `content` (the multimodal array some older
 * extension builds mistakenly persisted) corrupts that render too. Patch
 * graph fields + flatten any leftover array content in place; preserve
 * files/followUps.
 * @param {string} remoteId
 * @returns {Promise<boolean>} true if an update was written
 */
export async function repairRemoteChatGraph(remoteId) {
  if (!remoteId) return false;
  try {
    const remote = await chatsApi.getChat(remoteId);
    if (!remote) return false;
    const chat = remote.chat || remote;
    const history = chat?.history;
    const map = history?.messages;
    if (!history || !map || typeof map !== 'object') return false;

    let dirty = false;

    for (const [id, raw] of Object.entries(map)) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw;
      if (!m.id) {
        m.id = id;
        dirty = true;
      }
      if (!('parentId' in m)) {
        m.parentId = null;
        dirty = true;
      }
      if (!Array.isArray(m.childrenIds)) {
        m.childrenIds = [];
        dirty = true;
      }
      if (typeof m.content !== 'string') {
        const flat = sanitizeHistoryContent(m.content);
        if (flat !== m.content) {
          m.content = flat;
          dirty = true;
          console.warn('[Neura] repaired non-string message content', { remoteId, id });
        }
      }
    }

    const currentId = history.currentId;
    const current = currentId ? map[currentId] : null;
    const currentValid = !!(current && current.role && current.id);

    if (!currentValid) {
      /** @type {{ id: string, ts: number }[]} */
      const leaves = [];
      for (const [id, m] of Object.entries(map)) {
        if (!m?.role || !m.id) continue;
        if (!Array.isArray(m.childrenIds) || m.childrenIds.length > 0) continue;
        leaves.push({ id, ts: toMillis(m.timestamp) || 0 });
      }
      leaves.sort((a, b) => b.ts - a.ts);
      const fallback = leaves[0]?.id || Object.keys(map).find((id) => map[id]?.role) || null;
      if (fallback && fallback !== currentId) {
        history.currentId = fallback;
        dirty = true;
        console.warn('[Neura] repaired chat currentId', { remoteId, from: currentId, to: fallback });
      }
    }

    if (!dirty) return false;

    // Keep messages[] aligned with history (OWUI reads both).
    const ordered = [];
    let walkId = history.currentId;
    const seen = new Set();
    while (walkId && map[walkId] && !seen.has(walkId)) {
      seen.add(walkId);
      ordered.unshift(map[walkId]);
      walkId = map[walkId].parentId != null ? map[walkId].parentId : null;
    }
    chat.history = history;
    chat.messages = ordered;
    chat.id = remoteId;

    await chatsApi.updateChat(remoteId, chat);
    return true;
  } catch (e) {
    console.warn('[Neura] repairRemoteChatGraph failed', e);
    return false;
  }
}

/**
 * @returns {Promise<Array<{id: string, title: string, updatedAt: number}>>}
 */
export async function readLocalIndex() {
  const { [INDEX_KEY]: index } = await chrome.storage.local.get([INDEX_KEY]);
  return Array.isArray(index) ? index : [];
}

/**
 * @param {string} localId
 * @returns {Promise<object|null>}
 */
export async function readLocalChat(localId) {
  if (!localId) return null;
  const { [chatKey(localId)]: chat } = await chrome.storage.local.get([chatKey(localId)]);
  return chat || null;
}

/**
 * @param {object} chat
 * @returns {Promise<void>}
 */
export async function writeLocalChat(chat) {
  if (!chat?.id) return;
  const index = await readLocalIndex();
  const entry = {
    id: chat.id,
    title: chat.title,
    updatedAt: toMillis(chat.updatedAt) || Date.now(),
    folderId: chat.folderId || null,
  };
  const idx = index.findIndex((c) => c.id === chat.id);
  if (idx === -1) index.unshift(entry);
  else index[idx] = entry;
  index.sort(sortByUpdatedDesc);
  await chrome.storage.local.set({
    [chatKey(chat.id)]: { ...chat, updatedAt: entry.updatedAt },
    [INDEX_KEY]: index,
  });
}

/**
 * @param {string} localId
 * @param {{ title?: string, messages: object[], updatedAt?: number }} data
 * @returns {Promise<object|null>}
 */
export async function replaceLocalChat(localId, data) {
  const existing = (await readLocalChat(localId)) || {
    id: localId,
    createdAt: Date.now(),
  };
  const chat = {
    ...existing,
    title: data.title || existing.title || 'New Chat',
    messages: data.messages || [],
    updatedAt: toMillis(data.updatedAt) || Date.now(),
  };
  await writeLocalChat(chat);
  return chat;
}

/**
 * @param {string} localId
 * @param {string} title
 * @param {string} model
 * @param {object[]} messages
 * @param {{ folderId?: string|null }} [opts]
 * @returns {Promise<string|null>} remoteId
 */
export async function ensureRemoteChat(localId, title, model, messages = [], opts = {}) {
  const mapping = await syncStore.getMapping(localId);
  if (mapping?.remoteId) return mapping.remoteId;

  const folderId = opts.folderId || null;
  const blob = buildChatBlob({ title, model, messages });
  const created = await chatsApi.createChat(blob, folderId);
  const remoteId =
    created?.id || created?.chat_id || created?.chat?.id || created?.data?.id;
  if (!remoteId) {
    await syncStore.setSyncStatus(localId, 'error');
    return null;
  }
  const updateBlob = buildChatBlob({ id: remoteId, title, model, messages });
  await chatsApi.updateChat(remoteId, updateBlob);
  await syncStore.setMapping(localId, remoteId, 'synced');
  return remoteId;
}

/**
 * Resolve a server chat id, pushing a local-only chat first when needed.
 * @param {string|null|undefined} localChatId
 * @param {string|null|undefined} remoteId
 * @returns {Promise<string|null>}
 */
export async function resolveRemoteId(localChatId, remoteId) {
  if (remoteId) return remoteId;
  const mapped = (await syncStore.getMapping(localChatId || ''))?.remoteId;
  if (mapped) return mapped;
  const local = localChatId ? await readLocalChat(localChatId) : null;
  if (!local) return null;

  let model = local.model || '';
  if (!model) {
    try {
      const stored = await chrome.storage.sync.get(['neuraModel']);
      model = stored.neuraModel || 'NEURA-IANUSTEC';
    } catch (e) {
      model = 'NEURA-IANUSTEC';
    }
  }

  try {
    await retryPushFullChatBlob({
      localChatId: local.id,
      messages: local.messages || [],
      title: local.title,
      model,
    });
  } catch (e) {
    console.warn('[Neura] resolveRemoteId push failed', e);
    return (await syncStore.getMapping(local.id))?.remoteId || null;
  }
  return (await syncStore.getMapping(local.id))?.remoteId || null;
}

/**
 * Create a local chat and immediately sync it into an OWUI folder.
 * @param {{ title?: string, model?: string, folderId: string }} opts
 * @returns {Promise<{ localId: string, remoteId: string, chat: object }>}
 */
export async function createChatInFolder(opts) {
  const folderId = opts?.folderId;
  if (!folderId) throw new Error('Missing folderId');

  let model = opts.model || '';
  if (!model) {
    try {
      const stored = await chrome.storage.sync.get(['neuraModel']);
      model = stored.neuraModel || 'NEURA-IANUSTEC';
    } catch (e) {
      model = 'NEURA-IANUSTEC';
    }
  }

  const title = opts.title || 'New Chat';
  const localId = makeLocalId();
  const chat = {
    id: localId,
    title,
    messages: [],
    model,
    folderId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await writeLocalChat(chat);

  const remoteId = await ensureRemoteChat(localId, title, model, [], { folderId });
  if (!remoteId) throw new Error('Failed to create chat on server');

  // Re-read so callers get the persisted folderId.
  const saved = (await readLocalChat(localId)) || chat;
  return { localId, remoteId, chat: saved };
}

/**
 * Core push logic — throws on failure so both the "live" caller (api.js,
 * right after a turn) and the outbox retry path can share identical
 * behavior and error handling.
 * @param {object} opts
 * @returns {Promise<void>}
 */
export async function retryPushTurnToServer(opts) {
  const {
    localChatId,
    title,
    model,
    modelItem,
    priorMessages = [],
    userMessage,
    assistantMessage,
    sessionId,
    filterIds = [],
  } = opts;
  if (!localChatId) return;

  const remoteId = await ensureRemoteChat(localChatId, title, model, priorMessages);
  if (!remoteId) throw new Error('ensureRemoteChat did not return a remote id');

  const allMessages = [...priorMessages];
  if (userMessage) allMessages.push(userMessage);
  if (assistantMessage) allMessages.push(assistantMessage);

  const blob = buildChatBlob({
    id: remoteId,
    title,
    model,
    messages: allMessages,
  });
  await chatsApi.updateChat(remoteId, blob);
  await chatsApi.completeChatTurn({
    model,
    messages: blob.messages || [],
    chat_id: remoteId,
    id: assistantMessage?.id || userMessage?.id,
    session_id: sessionId || null,
    filter_ids: filterIds,
    model_item: modelItem || null,
  });
  // Follow-up generation can leave a role-less placeholder as currentId → OWUI
  // infinite spinner. Repair graph fields without wiping message content.
  await repairRemoteChatGraph(remoteId);
  await syncStore.setSyncStatus(localChatId, 'synced');
}

/**
 * Pushes a completed turn to Open WebUI right away. If the write fails
 * (offline, server unreachable, ...) the operation is queued in the outbox
 * for automatic retry instead of being dropped — the local chat history
 * itself is unaffected either way, since it is saved independently by the
 * content script before this is ever called.
 * @param {object} opts
 * @returns {Promise<void>}
 */
export async function pushTurnToServer(opts) {
  if (!opts?.localChatId) return;
  try {
    await retryPushTurnToServer(opts);
  } catch (e) {
    console.warn('[Neura] pushTurnToServer failed; queued for retry', e);
    await syncStore.setSyncStatus(opts.localChatId, 'pending');
    await outbox.enqueue('pushTurn', opts);
  }
}

/**
 * Store the title/tags Open WebUI generated for a turn.
 *
 * Open WebUI runs title and tag generation itself and pushes the result over the
 * socket as `chat:title` / `chat:tags` (it has already written both server-side),
 * so this only mirrors the values into the local chat record for the sidebar.
 *
 * @param {string} localChatId
 * @param {{ title?: string, tags?: string[] }} meta
 * @returns {Promise<{ title: string, tags: string[] }|null>} null when nothing changed
 */
export async function applyGeneratedChatMeta(localChatId, meta) {
  if (!localChatId) return null;
  const local = await readLocalChat(localChatId);
  if (!local) return null;

  const nextTitle = typeof meta?.title === 'string' ? meta.title.trim() : '';
  const nextTags = Array.isArray(meta?.tags) ? meta.tags.filter(Boolean) : null;

  const titleChanged = !!nextTitle && nextTitle !== local.title;
  const previousTags = Array.isArray(local.tags) ? local.tags : [];
  const tagsChanged = !!nextTags && JSON.stringify(nextTags) !== JSON.stringify(previousTags);
  if (!titleChanged && !tagsChanged) return null;

  if (titleChanged) local.title = nextTitle;
  if (tagsChanged) local.tags = nextTags;
  await writeLocalChat(local);

  return { title: local.title, tags: Array.isArray(local.tags) ? local.tags : [] };
}

/**
 * Re-reads the remote chat to pick up the title/tags Open WebUI generates
 * asynchronously after a turn (background_tasks.title_generation /
 * tags_generation). Returns null when nothing changed so callers can skip
 * a UI update; otherwise returns the new values to broadcast.
 * @param {string} localChatId
 * @param {string} previousTitle
 * @returns {Promise<{ title: string, tags: string[] }|null>}
 */
export async function refreshGeneratedChatMeta(localChatId, previousTitle) {
  const mapping = await syncStore.getMapping(localChatId);
  if (!mapping?.remoteId) return null;

  const remote = await chatsApi.getChat(mapping.remoteId);
  if (!remote) return null;

  const parsed = parseChatBlob(remote);
  if (!parsed) return null;

  const titleChanged = !!parsed.title && parsed.title !== previousTitle;
  const local = await readLocalChat(localChatId);
  const previousTags = Array.isArray(local?.tags) ? local.tags : [];
  const tagsChanged =
    JSON.stringify(parsed.tags || []) !== JSON.stringify(previousTags);

  if (titleChanged || tagsChanged) {
    if (local) {
      local.title = parsed.title || local.title;
      local.tags = parsed.tags || [];
      // Prefer server mtime — never stamp "now" or the sidebar drifts from OWUI.
      const remoteUpdated = getRemoteUpdatedAt(remote);
      if (remoteUpdated) local.updatedAt = remoteUpdated;
      await writeLocalChat(local);
    }

    await repairRemoteChatGraph(mapping.remoteId);
    return { title: parsed.title, tags: parsed.tags || [] };
  }

  // Title/tags unchanged — still heal graph orphans from follow-up placeholders.
  await repairRemoteChatGraph(mapping.remoteId);
  return null;
}

/**
 * @param {string} localChatId
 * @returns {Promise<object|null>}
 */
export async function pullAndMergeLocalChat(localChatId) {
  const mapping = await syncStore.getMapping(localChatId);
  if (!mapping?.remoteId) return readLocalChat(localChatId);

  const remote = await chatsApi.getChat(mapping.remoteId);
  if (!remote) return readLocalChat(localChatId);

  // Heal any pre-existing corruption (e.g. non-string content from older
  // extension builds, orphan graph nodes) whenever a chat is opened, so
  // both the extension and the OWUI web app render it correctly going forward.
  repairRemoteChatGraph(mapping.remoteId).catch(() => {});

  const parsed = parseChatBlob(remote);
  if (!parsed) return readLocalChat(localChatId);

  const local = await readLocalChat(localChatId);
  const localUpdated = toMillis(local?.updatedAt);
  const remoteUpdated = toMillis(getRemoteUpdatedAt(remote));

  if (remoteUpdated >= localUpdated) {
    const merged = await replaceLocalChat(localChatId, {
      title: parsed.title,
      messages: parsed.messages,
      updatedAt: remoteUpdated || parsed.updatedAt,
    });
    await syncStore.markPulled(localChatId);
    return merged;
  }
  return local;
}

/**
 * @param {string} remoteId
 * @returns {Promise<{ localId: string, chat: object }|null>}
 */
export async function importRemoteChat(remoteId) {
  if (!remoteId) return null;

  let localId = await syncStore.getLocalIdByRemote(remoteId);
  const remote = await chatsApi.getChat(remoteId);
  if (!remote) return null;

  repairRemoteChatGraph(remoteId).catch(() => {});

  const parsed = parseChatBlob(remote);
  if (!parsed) return null;

  if (!localId) {
    localId = makeLocalId();
    await syncStore.setMapping(localId, remoteId, 'synced');
  }

  const chat = {
    id: localId,
    title: parsed.title,
    messages: parsed.messages,
    createdAt: Date.now(),
    updatedAt: toMillis(parsed.updatedAt) || toMillis(getRemoteUpdatedAt(remote)) || Date.now(),
  };
  await writeLocalChat(chat);
  await syncStore.markPulled(localId);
  return { localId, chat };
}

/**
 * Chat list for the sidebar — Open WebUI is the source of truth for title,
 * updatedAt, and order. Local storage is only used to resolve localId for
 * already-synced chats and to surface offline local-only drafts that have
 * messages but are not on the server yet.
 * @returns {Promise<object[]>}
 */
export async function listUnifiedChats() {
  const mappings = await syncStore.allMappings();
  /** @type {Map<string, string>} remoteId → localId */
  const remoteToLocal = new Map();
  for (const [localId, entry] of Object.entries(mappings)) {
    if (entry?.remoteId) remoteToLocal.set(String(entry.remoteId), localId);
  }

  let remoteList = [];
  let remoteOk = false;
  try {
    remoteList = await chatsApi.listAllChats();
    remoteOk = true;
  } catch (e) {
    console.warn('[Neura] listUnifiedChats remote fetch failed', e);
  }

  /** @type {object[]} */
  const items = [];
  const seenRemote = new Set();
  const seenLocal = new Set();

  if (remoteOk) {
    for (const remote of remoteList) {
      const remoteId = remote.id || remote.chat_id;
      if (!remoteId || remote.folder_id) continue;
      const rid = String(remoteId);
      seenRemote.add(rid);

      const localId = remoteToLocal.get(rid) || null;
      if (localId) seenLocal.add(localId);

      items.push({
        id: localId,
        remoteId: rid,
        title: remote.title || 'Chat',
        updatedAt: toMillis(remote.updated_at || remote.timestamp || 0),
        syncStatus: localId ? (mappings[localId]?.status || 'synced') : 'cloud-only',
        source: localId ? 'local' : 'remote',
        folderId: null,
      });
    }
  }

  // Local chats: always include not-yet-pushed drafts with messages.
  // If OWUI is unreachable, fall back to the full local index.
  const localIndex = await readLocalIndex();
  for (const local of localIndex) {
    if (local.folderId || seenLocal.has(local.id)) continue;
    const mapping = mappings[local.id];
    if (remoteOk && mapping?.remoteId && seenRemote.has(String(mapping.remoteId))) continue;
    // When online, skip locals that are already mapped — OWUI row is authoritative.
    if (remoteOk && mapping?.remoteId) continue;

    const full = await readLocalChat(local.id);
    if (!full || full.folderId) continue;
    if (!Array.isArray(full.messages) || full.messages.length === 0) {
      try {
        const next = (await readLocalIndex()).filter((e) => e.id !== local.id);
        await chrome.storage.local.set({ [INDEX_KEY]: next });
      } catch (e) {
        /* ignore */
      }
      continue;
    }

    items.push({
      id: local.id,
      title: local.title || full.title || 'Chat',
      updatedAt: toMillis(full.updatedAt || local.updatedAt),
      remoteId: mapping?.remoteId || null,
      syncStatus: mapping?.status || 'local-only',
      source: 'local',
      folderId: null,
    });
  }

  items.sort(sortByUpdatedDesc);
  return items;
}

/**
 * Persist folder membership on the local chat after a server move.
 * @param {string|null|undefined} localChatId
 * @param {string|null} folderId
 */
export async function setLocalChatFolder(localChatId, folderId) {
  if (!localChatId) return;
  const local = await readLocalChat(localChatId);
  if (!local) return;
  local.folderId = folderId || null;
  local.updatedAt = Date.now();
  await writeLocalChat(local);
}

/**
 * Core push logic — throws on failure (see retryPushTurnToServer for why).
 * @param {{ localChatId: string, messages: object[], title: string, model: string }} opts
 * @returns {Promise<void>}
 */
export async function retryPushFullChatBlob(opts) {
  const { localChatId, messages, title, model } = opts;
  if (!localChatId) return;

  const mapping = await syncStore.getMapping(localChatId);
  const remoteId =
    mapping?.remoteId ||
    (await ensureRemoteChat(localChatId, title, model, messages));
  if (!remoteId) throw new Error('ensureRemoteChat did not return a remote id');

  const blob = buildChatBlob({ id: remoteId, title, model, messages });
  await chatsApi.updateChat(remoteId, blob);
  await syncStore.setSyncStatus(localChatId, 'synced');
}

/**
 * @param {string} localChatId
 * @param {object[]} messages
 * @param {string} title
 * @param {string} model
 * @returns {Promise<void>}
 */
export async function pushFullChatBlob(localChatId, messages, title, model) {
  const opts = { localChatId, messages, title, model };
  try {
    await retryPushFullChatBlob(opts);
  } catch (e) {
    console.warn('[Neura] pushFullChatBlob failed; queued for retry', e);
    await syncStore.setSyncStatus(localChatId, 'pending');
    await outbox.enqueue('pushFullBlob', opts);
  }
}

/**
 * @param {string} localChatId
 * @returns {Promise<boolean>}
 */
export async function deleteRemoteChat(localChatId) {
  const mapping = await syncStore.getMapping(localChatId);
  if (!mapping?.remoteId) {
    await syncStore.removeMapping(localChatId);
    return true;
  }
  const ok = await chatsApi.deleteChat(mapping.remoteId);
  await syncStore.removeMapping(localChatId);
  return ok;
}

/**
 * Delete every non-pinned chat for the current account on the server,
 * drop non-pinned local chats + sync mappings. Pinned chats are kept.
 * @returns {Promise<{ ok: boolean, keptRemoteIds: string[], keptLocalIds: string[] }>}
 */
export async function deleteAllChats() {
  const result = await chatsApi.deleteAllChats();
  const keptRemoteIds = (result.keptRemoteIds || []).map(String);
  const keptSet = new Set(keptRemoteIds);

  const mappings = await syncStore.allMappings();
  const localIndex = await readLocalIndex();
  /** @type {string[]} */
  const keptLocalIds = [];
  /** @type {string[]} */
  const removeKeys = [];

  for (const entry of localIndex) {
    const localId = entry.id;
    const remoteId = mappings[localId]?.remoteId
      ? String(mappings[localId].remoteId)
      : '';
    if (remoteId && keptSet.has(remoteId)) {
      keptLocalIds.push(localId);
      continue;
    }
    removeKeys.push(chatKey(localId));
  }

  if (removeKeys.length) {
    await chrome.storage.local.remove(removeKeys);
  }

  const nextIndex = localIndex.filter((e) => keptLocalIds.includes(e.id));
  await chrome.storage.local.set({ [INDEX_KEY]: nextIndex });

  await syncStore.clearExceptRemoteIds(keptRemoteIds);

  return {
    ok: !!result.ok,
    keptRemoteIds,
    keptLocalIds,
  };
}

/**
 * Bidirectional chat sync: push local-only / pending chats to OWUI, pull
 * remote list and merge newer remote content into local storage.
 * Safe to call frequently (e.g. every 30s); skips when unauthenticated.
 * @returns {Promise<{ ok: boolean, pushed: number, pulled: number, reason?: string }>}
 */
export async function syncChatsBidirectional() {
  const token = await getToken();
  if (!token) return { ok: false, pushed: 0, pulled: 0, reason: 'auth' };

  let pushed = 0;
  let pulled = 0;

  try {
    await outbox.drainQueue();
  } catch (e) {
    console.warn('[Neura] sync: outbox drain failed', e);
  }

  const localIndex = await readLocalIndex();
  const mappings = await syncStore.allMappings();

  // Push local chats that are not yet on the server (or pending).
  for (const entry of localIndex) {
    const mapping = mappings[entry.id];
    const needsPush =
      !mapping?.remoteId ||
      mapping.status === 'pending' ||
      mapping.status === 'error' ||
      mapping.status === 'local-only';
    if (!needsPush) continue;

    const local = await readLocalChat(entry.id);
    if (!local) continue;
    // Skip brand-new empty drafts; first turn already pushes.
    if (!(local.messages || []).length && !mapping?.remoteId) continue;

    let model = local.model || '';
    if (!model) {
      try {
        const stored = await chrome.storage.sync.get(['neuraModel']);
        model = stored.neuraModel || 'NEURA-IANUSTEC';
      } catch (e) {
        model = 'NEURA-IANUSTEC';
      }
    }

    try {
      await pushFullChatBlob(local.id, local.messages || [], local.title, model);
      pushed += 1;
    } catch (e) {
      console.warn('[Neura] sync: push failed for', local.id, e);
    }
  }

  // Pull remote list and merge newer chats into local storage.
  let remoteList = [];
  try {
    remoteList = await chatsApi.listAllChats();
  } catch (e) {
    console.warn('[Neura] sync: remote list failed', e);
    return { ok: false, pushed, pulled, reason: 'list' };
  }

  const freshMappings = await syncStore.allMappings();

  for (const remote of remoteList) {
    const remoteId = remote.id || remote.chat_id;
    if (!remoteId || remote.folder_id) continue;

    const mappedLocalId = (await syncStore.getLocalIdByRemote(String(remoteId))) || null;
    if (!mappedLocalId) {
      // Unmapped remotes stay cloud-only in listUnifiedChats(); imported on open.
      continue;
    }

    // Drop stale mapping entries that vanished from local storage.
    if (!freshMappings[mappedLocalId]) continue;

    const local = await readLocalChat(mappedLocalId);
    const localUpdated = toMillis(local?.updatedAt);
    const remoteUpdated = toMillis(remote.updated_at || remote.timestamp || 0);

    if (remoteUpdated > localUpdated) {
      try {
        await pullAndMergeLocalChat(mappedLocalId);
        pulled += 1;
      } catch (e) {
        console.warn('[Neura] sync: pull failed for', mappedLocalId, e);
      }
    } else if (local && remoteUpdated > 0) {
      // OWUI is authoritative for mtime/title even when content is unchanged.
      let dirty = false;
      if (remoteUpdated !== localUpdated) {
        local.updatedAt = remoteUpdated;
        dirty = true;
      }
      if (remote.title && remote.title !== local.title) {
        local.title = remote.title;
        dirty = true;
      }
      if (dirty) await writeLocalChat(local);
    }
  }

  return { ok: true, pushed, pulled };
}

