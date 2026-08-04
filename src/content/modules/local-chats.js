(function (Neura) {
  // Local chat cache in chrome.storage.local, synced bidirectionally with
  // Open WebUI via the background service worker (chats-api / chat-sync).
  const INDEX_KEY = 'neuraLocalChatIndex';
  const ACTIVE_CHAT_KEY = 'neuraActiveChatId';
  const CHAT_KEY_PREFIX = 'neuraLocalChat:';

  function chatKey(id) {
    return CHAT_KEY_PREFIX + id;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (res) => resolve(res || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  function storageSet(items) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(items, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(keys, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }

  function makeId() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  }

  function deriveTitle(text) {
    const clean = String(text || '').trim().replace(/\s+/g, ' ');
    if (!clean) return Neura.i18n.t('newChat');
    return clean.length > 48 ? clean.slice(0, 48) + '…' : clean;
  }

  async function getIndex() {
    const { [INDEX_KEY]: index } = await storageGet([INDEX_KEY]);
    return Array.isArray(index) ? index : [];
  }

  async function saveIndex(index) {
    await storageSet({ [INDEX_KEY]: index });
  }

  async function upsertIndexEntry(chat) {
    const index = await getIndex();
    const entry = {
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
      folderId: chat.folderId || null,
    };
    const existingIdx = index.findIndex((c) => c.id === chat.id);
    if (existingIdx === -1) index.unshift(entry);
    else index[existingIdx] = { ...index[existingIdx], ...entry };
    index.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    await saveIndex(index);
  }

  async function removeIndexEntry(chatId) {
    const index = await getIndex();
    await saveIndex(index.filter((c) => c.id !== chatId));
  }

  function isEmptyChat(chat) {
    return !chat || !Array.isArray(chat.messages) || chat.messages.length === 0;
  }

  /**
   * Drop a chat from storage+index when it has no messages.
   * @param {string} chatId
   * @returns {Promise<boolean>} true if removed
   */
  async function discardIfEmpty(chatId) {
    if (!chatId) return false;
    const chat = await Neura.localChats.get(chatId);
    if (!isEmptyChat(chat)) return false;
    await storageRemove([chatKey(chatId)]);
    await removeIndexEntry(chatId);
    const { [ACTIVE_CHAT_KEY]: activeId } = await storageGet([ACTIVE_CHAT_KEY]);
    if (activeId === chatId) await storageRemove([ACTIVE_CHAT_KEY]);
    return true;
  }

  /**
   * Remove every local chat that has no messages (stale "Nuova chat" drafts).
   * Keeps the currently active empty draft in storage (unlisted) so the user
   * can still type into it. Folder chats are left alone.
   * @returns {Promise<number>} count removed from the index
   */
  async function pruneEmpty() {
    const index = await getIndex();
    const { [ACTIVE_CHAT_KEY]: activeId } = await storageGet([ACTIVE_CHAT_KEY]);
    const kept = [];
    let removed = 0;
    for (const entry of index) {
      if (entry.folderId) {
        kept.push(entry);
        continue;
      }
      const chat = await Neura.localChats.get(entry.id);
      if (isEmptyChat(chat)) {
        removed += 1;
        if (entry.id !== activeId) {
          await storageRemove([chatKey(entry.id)]);
        }
        continue;
      }
      kept.push(entry);
    }
    if (removed) await saveIndex(kept);
    return removed;
  }

  Neura.localChats = {
    /**
     * @returns {Promise<Array<{id: string, title: string, updatedAt: number}>>}
     */
    async list() {
      return getIndex();
    },

    /**
     * @param {string} chatId
     * @returns {Promise<object|null>}
     */
    async get(chatId) {
      if (!chatId) return null;
      const { [chatKey(chatId)]: chat } = await storageGet([chatKey(chatId)]);
      return chat || null;
    },

    /**
     * Create a draft chat in storage but do NOT list it until the first message.
     * Empty "Nuova chat" drafts must not clutter history.
     * @returns {Promise<object>}
     */
    async create(title) {
      const chat = {
        id: makeId(),
        title: title || Neura.i18n.t('newChat'),
        messages: [],
        updatedAt: Date.now(),
        createdAt: Date.now(),
      };
      await storageSet({ [chatKey(chat.id)]: chat });
      return chat;
    },

    /**
     * Append a message to a chat, creating it first if it doesn't exist yet.
     * @param {string} chatId
     * @param {{ role: string, content: string, files?: object[], model?: string }} message
     * @returns {Promise<{ id: string, role: string, content: string, files?: object[], model?: string, timestamp: number }|null>}
     */
    async addMessage(chatId, message) {
      if (!chatId || !message) return null;
      let chat = await Neura.localChats.get(chatId);
      if (!chat) {
        chat = {
          id: chatId,
          title: Neura.i18n.t('newChat'),
          messages: [],
          updatedAt: Date.now(),
          createdAt: Date.now(),
        };
      }
      // Persist display meta only (Conduit stores files on the user message;
      // we omit huge web/YouTube `file.data.content` to stay within storage quotas).
      const files = Array.isArray(message.files)
        ? message.files
            .filter(Boolean)
            .map((f) => {
              /** @type {Record<string, unknown>} */
              const out = {
                type: f.type || 'file',
                name: f.name || f.filename || f.title || f.file?.meta?.name || '',
              };
              const url = f.url || f.href || '';
              if (url) out.url = url;
              if (f.id) out.id = f.id;
              if (f.content_type || f.contentType) {
                out.content_type = f.content_type || f.contentType;
              }
              if (f.knowledge) out.knowledge = true;
              if (f.collection_name) out.collection_name = f.collection_name;
              if (f.context) out.context = f.context;
              return out;
            })
            .filter((f) => f.name || f.url || f.id || f.type === 'text' || f.type === 'collection')
        : undefined;
      const saved = {
        id: makeId(),
        role: message.role,
        content: message.content || '',
        timestamp: Date.now(),
      };
      if (files && files.length > 0) saved.files = files;
      // Model that produced this specific assistant reply — used to render
      // the correct avatar for this message forever, regardless of which
      // model is active later (see session.js renderMessages). Same field
      // name as the OWUI chat blob (background/chat-blob.js `entry.model`)
      // so it round-trips through server sync untouched.
      if (message.role === 'assistant' && message.model) {
        saved.model = message.model;
      }
      chat.messages.push(saved);
      if (message.role === 'user' && (!chat.title || chat.title === Neura.i18n.t('newChat'))) {
        chat.title = deriveTitle(message.content);
      }
      chat.updatedAt = Date.now();
      await storageSet({ [chatKey(chat.id)]: chat });
      await upsertIndexEntry(chat);
      return saved;
    },

    /**
     * Append one file descriptor onto an already-saved message — used when a
     * vision screenshot finishes uploading to OWUI Files API after the user
     * message was already persisted locally, so it survives a chat switch or
     * page reload the same way composer attachments do.
     * @param {string} chatId
     * @param {string} messageId
     * @param {object} file
     * @returns {Promise<object|null>}
     */
    async appendFileToMessage(chatId, messageId, file) {
      if (!chatId || !messageId || !file) return null;
      const chat = await Neura.localChats.get(chatId);
      if (!chat) return null;
      const msg = chat.messages.find((m) => m.id === messageId);
      if (!msg) return null;
      /** @type {Record<string, unknown>} */
      const entry = {
        type: file.type || 'file',
        name: file.name || file.filename || '',
      };
      const url = file.url || file.href || '';
      if (url) entry.url = url;
      if (file.id) entry.id = file.id;
      if (file.content_type || file.contentType) {
        entry.content_type = file.content_type || file.contentType;
      }
      if (file.context) entry.context = file.context;
      msg.files = Array.isArray(msg.files) ? [...msg.files, entry] : [entry];
      chat.updatedAt = Date.now();
      await storageSet({ [chatKey(chat.id)]: chat });
      await upsertIndexEntry(chat);
      return msg;
    },

    /**
     * Remove a message and every message after it (by position) from a chat.
     * @param {string} chatId
     * @param {string} messageId
     */
    async truncateFrom(chatId, messageId) {
      const chat = await Neura.localChats.get(chatId);
      if (!chat) return;
      const idx = chat.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      chat.messages = chat.messages.slice(0, idx);
      chat.updatedAt = Date.now();
      await storageSet({ [chatKey(chat.id)]: chat });
      await upsertIndexEntry(chat);
    },

    /**
     * @param {object|null} chat
     * @returns {Array<{ role: string, content: string }>}
     */
    toConversationHistory(chat) {
      if (!chat || !Array.isArray(chat.messages)) return [];
      return chat.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));
    },

    /**
     * Full message history with stable ids for OWUI sync.
     * @param {object|null} chat
     * @returns {Array<{ id: string, role: string, content: string, timestamp?: number, files?: object[] }>}
     */
    toRemoteHistory(chat) {
      if (!chat || !Array.isArray(chat.messages)) return [];
      return chat.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => {
          /** @type {Record<string, unknown>} */
          const out = {
            id: m.id,
            role: m.role,
            content: m.content || '',
            timestamp: m.timestamp || Date.now(),
          };
          if (Array.isArray(m.files) && m.files.length > 0) out.files = m.files;
          return out;
        });
    },

    /**
     * Replace chat content (used when pulling from OWUI server).
     * @param {string} chatId
     * @param {{ title?: string, messages?: object[] }} data
     */
    async replace(chatId, data) {
      if (!chatId) return null;
      let chat = await Neura.localChats.get(chatId);
      if (!chat) {
        chat = {
          id: chatId,
          title: data.title || Neura.i18n.t('newChat'),
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }
      if (data.title) chat.title = data.title;
      if (Array.isArray(data.messages)) chat.messages = data.messages;
      chat.updatedAt = Date.now();
      await storageSet({ [chatKey(chat.id)]: chat });
      await upsertIndexEntry(chat);
      return chat;
    },

    /**
     * @param {string} chatId
     */
    async remove(chatId) {
      if (!chatId) return;
      await storageRemove([chatKey(chatId)]);
      await removeIndexEntry(chatId);
      const { [ACTIVE_CHAT_KEY]: activeId } = await storageGet([ACTIVE_CHAT_KEY]);
      if (activeId === chatId) await storageRemove([ACTIVE_CHAT_KEY]);
    },

    /**
     * Delete every local chat (used by the "clear all history" setting).
     */
    async removeAll() {
      const index = await getIndex();
      const keys = index.map((c) => chatKey(c.id));
      if (keys.length) await storageRemove(keys);
      await storageRemove([INDEX_KEY, ACTIVE_CHAT_KEY, 'neuraChatByUrl']);
    },

    /**
     * @returns {Promise<string|null>}
     */
    async getActiveId() {
      const { [ACTIVE_CHAT_KEY]: activeId } = await storageGet([ACTIVE_CHAT_KEY]);
      if (!activeId) return null;
      const chat = await Neura.localChats.get(activeId);
      return chat ? activeId : null;
    },

    /**
     * @param {string|null} chatId
     */
    async setActiveId(chatId) {
      if (chatId) await storageSet({ [ACTIVE_CHAT_KEY]: chatId });
      else await storageRemove([ACTIVE_CHAT_KEY]);
    },

    isEmpty: isEmptyChat,
    discardIfEmpty,
    pruneEmpty,
  };
})(window.Neura);
