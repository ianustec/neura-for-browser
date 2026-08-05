import { toMillis } from './timestamp-utils.js';

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `m_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * OWUI message timestamps are Unix **seconds** (see Messages.svelte).
 * Accept ms/seconds/µs and normalize to seconds.
 * @param {unknown} ts
 * @returns {number}
 */
export function toUnixSeconds(ts) {
  const ms = toMillis(ts);
  if (!ms) return Math.floor(Date.now() / 1000);
  return Math.floor(ms / 1000);
}

/**
 * OWUI's own web client (Chat.svelte) NEVER persists `content` as a
 * multimodal array — that array shape is only built in memory right before
 * the `/api/chat/completions` call. `history.messages[id].content` is always
 * plain text; UserMessage.svelte feeds it straight into `<Markdown>`, which
 * breaks/corrupts the message tree render if given anything else. Images
 * belong exclusively in `files[]`. Collapse any multimodal content down to
 * its text parts only — defensive against any legacy/ephemeral array content
 * that reaches this far.
 * @param {unknown} content
 * @returns {string}
 */
export function sanitizeHistoryContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content);

  const textBits = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (String(part.type || '') === 'text' && part.text) {
      textBits.push(String(part.text));
    }
  }
  return textBits.join('\n');
}

/**
 * Slim file descriptors for history (OWUI-safe core fields).
 * @param {unknown} files
 * @returns {object[]|undefined}
 */
function sanitizeHistoryFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return undefined;
  const out = [];
  for (const f of files) {
    if (!f || typeof f !== 'object') continue;
    const id = f.id != null ? String(f.id) : '';
    const url = f.url != null ? String(f.url) : id;
    if (!id && !url) continue;
    /** @type {Record<string, unknown>} */
    const entry = {
      type: f.type || 'file',
      id: id || url,
      url: url || id,
    };
    if (f.name) entry.name = f.name;
    if (f.content_type) entry.content_type = f.content_type;
    else if (f.contentType) entry.content_type = f.contentType;
    // Optional OWUI / Neura metadata (harmless if ignored by UI).
    if (f.collection_name) entry.collection_name = f.collection_name;
    if (f.context) entry.context = f.context;
    if (f.sourceUrl) entry.sourceUrl = f.sourceUrl;
    if (f.meta && typeof f.meta === 'object') entry.meta = f.meta;
    out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Build an OWUI chat blob matching the web UI tree contract:
 * - every node has id, role, parentId (null for root), childrenIds (array)
 * - message timestamps in Unix seconds
 * - user: models[]; assistant: model, modelName, modelIdx, done
 * - no huge data: URLs in persisted content
 *
 * @param {object} opts
 * @param {string} [opts.id]
 * @param {string} [opts.title]
 * @param {string} [opts.model]
 * @param {object[]} [opts.messages]
 * @param {string} [opts.system]
 * @param {string[]} [opts.tags]
 * @returns {object}
 */
export function buildChatBlob(opts = {}) {
  const {
    id = '',
    title = 'New Chat',
    model = '',
    messages = [],
    system = '',
    tags = [],
  } = opts;

  const modelId = model || '';
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];

  // Pass 1: stable ids for every message (fixes childrenIds when next lacked id).
  const ids = list.map((m) => {
    if (m.id) return String(m.id);
    const generated = makeId();
    m.id = generated;
    return generated;
  });

  /** @type {Record<string, object>} */
  const historyMessages = {};

  for (let i = 0; i < list.length; i += 1) {
    const m = list[i];
    const msgId = ids[i];
    const nextId = i + 1 < ids.length ? ids[i + 1] : null;
    // Critical for OWUI: root must be `null`, never missing/`undefined`
    // (`messages.at(0)?.parentId !== null` → infinite "Loading..." spinner).
    const parentId = i === 0 ? null : ids[i - 1];

    /** @type {Record<string, unknown>} */
    const entry = {
      id: msgId,
      parentId,
      childrenIds: nextId ? [nextId] : [],
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: sanitizeHistoryContent(m.content),
      timestamp: toUnixSeconds(m.timestamp),
    };

    const files = sanitizeHistoryFiles(m.files);
    if (files) entry.files = files;

    if (entry.role === 'user') {
      // OWUI web client always sets models on user turns.
      entry.models = Array.isArray(m.models) && m.models.length > 0
        ? m.models
        : modelId
          ? [modelId]
          : [];
    } else {
      const asstModel = m.model || modelId || '';
      entry.model = asstModel;
      entry.modelName = m.modelName || asstModel;
      entry.modelIdx = typeof m.modelIdx === 'number' ? m.modelIdx : 0;
      entry.done = m.done !== false;
    }

    historyMessages[msgId] = entry;
  }

  const currentId = ids.length > 0 ? ids[ids.length - 1] : null;
  const ordered = ids.map((mid) => historyMessages[mid]).filter(Boolean);

  return {
    id,
    title: title || 'New Chat',
    models: modelId ? [modelId] : [],
    options: {},
    system: system || '',
    history: {
      messages: historyMessages,
      currentId,
    },
    messages: ordered,
    tags: Array.isArray(tags) ? tags : [],
    timestamp: Date.now(), // chat-level stamp stays in ms (OWUI list/DB)
  };
}

/**
 * @param {object|null|undefined} blob
 * @returns {{ title: string, model: string|null, messages: object[], updatedAt: number }|null}
 */
export function parseChatBlob(blob) {
  const chat = blob?.chat || blob;
  if (!chat) return null;

  const history = chat.history?.messages || {};
  let currentId = chat.history?.currentId || null;
  /** @type {object[]} */
  const messages = [];
  const visited = new Set();

  while (currentId && history[currentId]) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const m = history[currentId];
    if (!m?.role) {
      currentId = m?.parentId || null;
      continue;
    }
    /** @type {Record<string, unknown>} */
    const local = {
      id: m.id || currentId,
      role: m.role,
      content: m.content || '',
      // Keep ms locally for UI sorting; OWUI stores seconds.
      timestamp: toMillis(m.timestamp) || Date.now(),
    };
    if (Array.isArray(m.files) && m.files.length > 0) local.files = m.files;
    // Preserve which model produced this reply so the extension keeps
    // showing that model's avatar after a reload/sync instead of falling
    // back to whatever model is active at render time.
    if (m.role === 'assistant' && m.model) local.model = m.model;
    messages.unshift(local);
    // Treat missing parentId like null (root) so we don't walk `undefined`.
    currentId = m.parentId != null ? m.parentId : null;
  }

  if (messages.length === 0 && Array.isArray(chat.messages) && chat.messages.length > 0) {
    for (const m of chat.messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      /** @type {Record<string, unknown>} */
      const local = {
        id: m.id || makeId(),
        role: m.role,
        content: m.content || '',
        timestamp: toMillis(m.timestamp) || Date.now(),
      };
      if (Array.isArray(m.files) && m.files.length > 0) local.files = m.files;
      if (m.role === 'assistant' && m.model) local.model = m.model;
      messages.push(local);
    }
  }

  const rawUpdated =
    blob?.updated_at ??
    chat.updated_at ??
    chat.timestamp ??
    Date.now();

  return {
    title: chat.title || 'New Chat',
    model: chat.models?.[0] || null,
    messages,
    tags: Array.isArray(chat.tags) ? chat.tags : [],
    updatedAt: toMillis(rawUpdated) || Date.now(),
  };
}

/**
 * Prefer server DB mtime (updated_at) over client blob timestamp.
 * @param {object|null|undefined} remoteChat
 * @returns {number} milliseconds
 */
export function getRemoteUpdatedAt(remoteChat) {
  if (!remoteChat) return 0;
  const chat = remoteChat.chat || remoteChat;
  const raw =
    remoteChat.updated_at ??
    chat?.updated_at ??
    chat?.timestamp ??
    remoteChat.timestamp ??
    0;
  return toMillis(raw);
}
