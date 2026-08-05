(function (Neura) {
  const IMPORT_FLAG_KEY = 'neuraLocalHistoryImported';
  // Remembers, per exact page URL, which local chat was last used there — so
  // reopening the extension on that same URL (even days later) resumes that
  // same conversation instead of whatever chat happened to be globally
  // "active" last. Bounded so it can't grow unbounded across a long
  // browsing history.
  const URL_CHAT_MAP_KEY = 'neuraChatByUrl';
  const URL_CHAT_MAP_MAX_ENTRIES = 300;

  const DRAFT_THROTTLE_MS = 250;
  let draftTrailingHandle = null;
  let lastDraftWriteAt = 0;
  let lastDraftValue = '';
  let pendingDirty = false;

  function getDomainFromHostname(hostname) {
    const domainRegex = /(?:[\w-]+\.)?([\w-]+\.[\w-]+)/;
    const match = hostname.match(domainRegex);
    return match ? match[1] : hostname;
  }

  /** @deprecated Use getActiveChatId() */
  function getSessionKey() {
    const currentUrl = window.location.href;
    const domain = getDomainFromHostname(window.location.hostname);
    const isURLSpecific = sessionStorage.getItem('neura_url_specific_chat') === 'true';
    return isURLSpecific ? 'url_' + currentUrl : 'domain_' + domain;
  }

  function draftKey(sessionKey) {
    return 'draft:' + sessionKey;
  }

  function writeDraftNow() {
    pendingDirty = false;
    lastDraftWriteAt = Date.now();
    const sessionKey = getSessionKey();
    const value = { partial: lastDraftValue, ts: lastDraftWriteAt };
    try {
      chrome.storage.local.set({ [draftKey(sessionKey)]: value });
    } catch (e) {}
  }

  /**
   * OWUI multimodal content is `[{type:'text',...}, {type:'image_url',...}]` —
   * the image already renders separately from `files[]`, so only the text
   * parts belong in the message bubble's caption.
   * @param {string|object[]} content
   * @returns {string}
   */
  function extractDisplayText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text)
        .join('\n')
        .trim();
    }
    return '';
  }

  function renderMessages(messages) {
    const messageArea = Neura.shadow.$('message-area');
    if (messageArea) messageArea.innerHTML = '';
    for (const msg of messages) {
      const content = msg.content ?? msg.text ?? '';
      const text = extractDisplayText(content);
      const opts = { messageId: msg.id };
      if (Array.isArray(msg.files) && msg.files.length > 0) {
        opts.files = msg.files;
      }
      if (msg.role === 'assistant' && msg.model) {
        opts.model = msg.model;
      }
      Neura.messages.addMessageToChat(msg.role, text, opts);
    }
  }

  async function collectLocalHistoryMessages() {
    const currentUrl = window.location.href;
    const domain = getDomainFromHostname(window.location.hostname);
    const urlSpecificKey = 'url_' + currentUrl;
    const domainKey = 'domain_' + domain;

    return new Promise((resolve) => {
      chrome.storage.sync.get([urlSpecificKey, domainKey], (result) => {
        let raw = null;
        if (result[urlSpecificKey]) raw = result[urlSpecificKey];
        else if (result[domainKey]) raw = result[domainKey];
        if (!raw) {
          resolve([]);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve([]);
        }
      });
    });
  }

  function getUrlChatMap() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([URL_CHAT_MAP_KEY], (res) => resolve(res[URL_CHAT_MAP_KEY] || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  /**
   * @param {string} chatId
   */
  async function rememberChatForCurrentUrl(chatId) {
    if (!chatId) return;
    try {
      const map = await getUrlChatMap();
      map[window.location.href] = { chatId, updatedAt: Date.now() };
      Neura.debug?.dlog?.('session', 'url-chat remembered', { url: window.location.href, chatId });
      const entries = Object.entries(map);
      if (entries.length > URL_CHAT_MAP_MAX_ENTRIES) {
        entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
        await new Promise((resolve) => {
          chrome.storage.local.set(
            { [URL_CHAT_MAP_KEY]: Object.fromEntries(entries.slice(0, URL_CHAT_MAP_MAX_ENTRIES)) },
            resolve,
          );
        });
      } else {
        await new Promise((resolve) => chrome.storage.local.set({ [URL_CHAT_MAP_KEY]: map }, resolve));
      }
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * @returns {Promise<string|null>}
   */
  async function getChatIdForCurrentUrl() {
    try {
      const map = await getUrlChatMap();
      const chatId = map[window.location.href]?.chatId || null;
      Neura.debug?.dlog?.('session', chatId ? 'url-chat lookup hit' : 'url-chat lookup miss', {
        url: window.location.href,
        chatId,
      });
      return chatId;
    } catch (e) {
      return null;
    }
  }

  async function maybeImportLocalHistory() {
    const imported = await new Promise((resolve) => {
      chrome.storage.local.get([IMPORT_FLAG_KEY], (r) => resolve(!!r[IMPORT_FLAG_KEY]));
    });
    if (imported) return null;

    const localMessages = await collectLocalHistoryMessages();
    if (!localMessages.length) {
      chrome.storage.local.set({ [IMPORT_FLAG_KEY]: true });
      return null;
    }

    const chat = await Neura.localChats.create(Neura.i18n.t('importedChatTitle'));
    for (const msg of localMessages) {
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;
      await Neura.localChats.addMessage(chat.id, { role: msg.role, content: msg.content || '' });
    }

    chrome.storage.local.set({ [IMPORT_FLAG_KEY]: true });
    await Neura.localChats.setActiveId(chat.id);
    if (Neura.chatSidebar) {
      Neura.chatSidebar.setActiveChatId(chat.id, chat.title);
      Neura.chatSidebar.refresh();
    }
    return { chatId: chat.id, imported: true };
  }

  Neura.session = {
    getDomainFromHostname,
    getSessionKey,
    rememberChatForCurrentUrl,
    getChatIdForCurrentUrl,

    getActiveChatId() {
      if (Neura.chatSidebar && Neura.chatSidebar.getActiveChatId) {
        return Neura.chatSidebar.getActiveChatId();
      }
      return null;
    },

    setActiveChatId(chatId, title) {
      if (Neura.chatSidebar) Neura.chatSidebar.setActiveChatId(chatId, title);
      Neura.localChats.setActiveId(chatId || null).catch(() => {});
    },

    /**
     * Returns the current active chat id, creating a new local chat first
     * if none exists yet (e.g. first message of a fresh session).
     * @returns {Promise<string>}
     */
    async ensureActiveChatId() {
      let chatId = Neura.session.getActiveChatId();
      if (!chatId) chatId = await Neura.localChats.getActiveId();
      if (chatId) return chatId;

      const chat = await Neura.localChats.create(Neura.i18n.t('newChat'));
      Neura.session.setActiveChatId(chat.id, chat.title);
      return chat.id;
    },

    setAssistantDraft(partial) {
      lastDraftValue = partial || '';
      pendingDirty = true;
      const now = Date.now();
      const elapsed = now - lastDraftWriteAt;
      if (elapsed >= DRAFT_THROTTLE_MS) {
        if (draftTrailingHandle) {
          clearTimeout(draftTrailingHandle);
          draftTrailingHandle = null;
        }
        writeDraftNow();
        return;
      }
      if (draftTrailingHandle) return;
      draftTrailingHandle = setTimeout(() => {
        draftTrailingHandle = null;
        if (pendingDirty) writeDraftNow();
      }, DRAFT_THROTTLE_MS - elapsed);
    },

    flushAssistantDraftSync() {
      if (draftTrailingHandle) {
        clearTimeout(draftTrailingHandle);
        draftTrailingHandle = null;
      }
      if (!pendingDirty || !lastDraftValue) return;
      writeDraftNow();
    },

    clearAssistantDraft() {
      if (draftTrailingHandle) {
        clearTimeout(draftTrailingHandle);
        draftTrailingHandle = null;
      }
      lastDraftValue = '';
      pendingDirty = false;
      const sessionKey = getSessionKey();
      try {
        chrome.storage.local.remove(draftKey(sessionKey));
      } catch (e) {}
    },

    getAssistantDraft() {
      const sessionKey = getSessionKey();
      return new Promise((resolve) => {
        try {
          chrome.storage.local.get([draftKey(sessionKey)], (res) => {
            resolve(res[draftKey(sessionKey)] || null);
          });
        } catch (e) {
          resolve(null);
        }
      });
    },

    /** @deprecated Messages persist locally and sync with Open WebUI server */
    saveMessageToSession() {},

    /** @deprecated */
    removeLastAssistantMessage() {},

    /** @deprecated */
    removeLastUserAndAssistantMessages() {},

    async loadChatMessages(chatId) {
      return Neura.session.loadChat(chatId);
    },

    async loadSessionMessages() {
      try {
        await Neura.localChats.pruneEmpty().catch(() => {});

        // The chat shown is decided strictly by the exact page URL — never by
        // whichever chat happens to be globally most recent. A URL seen
        // before resumes its own chat; an unrecognized URL always starts
        // from a clean, empty chat.
        let chatId = await getChatIdForCurrentUrl();
        if (chatId && !(await Neura.localChats.get(chatId))) chatId = null;

        let wasImported = false;

        if (!chatId) {
          // One-time legacy migration (pre-dates per-URL chats): only ever
          // runs once per install, so it does not act as a "most recent
          // chat" fallback for regular use.
          const imported = await maybeImportLocalHistory();
          if (imported?.chatId) {
            chatId = imported.chatId;
            wasImported = !!imported.imported;
          }
        }

        if (chatId) {
          const active = await Neura.localChats.get(chatId);
          if (Neura.localChats.isEmpty(active)) {
            // Keep the empty draft as the current session, but it is not listed.
            Neura.session.setActiveChatId(chatId, active?.title);
            const messageArea = Neura.shadow.$('message-area');
            if (messageArea) messageArea.innerHTML = '';
          } else {
            await Neura.session.loadChat(chatId);
          }
          if (wasImported && Neura.messages.showImportBanner) {
            Neura.messages.showImportBanner();
          }
        } else {
          // Unrecognized/new URL: clear any stale globally-active chat so a
          // fresh, empty chat is shown instead.
          Neura.session.setActiveChatId(null);
          const messageArea = Neura.shadow.$('message-area');
          if (messageArea) messageArea.innerHTML = '';
        }

        if (Neura.turnRejoin && Neura.turnRejoin.tryRehydrateDraft) {
          await Neura.turnRejoin.tryRehydrateDraft();
        }
      } catch (e) {
        console.warn('Neura: could not load session messages', e);
      }
    },

    async createNewChat(opts = {}) {
      if (Neura.streaming?.abortActiveStream) Neura.streaming.abortActiveStream();
      if (Neura.notesPanel?.isActive?.()) Neura.notesPanel.close({ restoreChat: false });

      // Drop the previous draft if the user never sent a message.
      const previousId = Neura.session.getActiveChatId() || (await Neura.localChats.getActiveId());
      if (previousId) {
        await Neura.localChats.discardIfEmpty(previousId);
      }

      const folderId = opts.folderId || null;
      let chat = null;

      if (folderId) {
        const res = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(
              {
                action: 'chats:createInFolder',
                folderId,
                title: Neura.i18n.t('newChat'),
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  resolve({ ok: false, error: chrome.runtime.lastError.message });
                  return;
                }
                resolve(response || { ok: false });
              },
            );
          } catch (e) {
            resolve({ ok: false, error: String(e) });
          }
        });
        if (res.ok && res.chat) {
          chat = res.chat;
        } else {
          console.warn('[Neura] createInFolder failed, falling back to local chat', res?.error);
        }
      }

      if (!chat) {
        chat = await Neura.localChats.create(Neura.i18n.t('newChat'));
      }

      const messageArea = Neura.shadow.$('message-area');
      if (messageArea) {
        messageArea.classList.remove('notes-panel-active');
        messageArea.innerHTML = '';
      }
      const inputWrapper = Neura.shadow.$('input-wrapper');
      if (inputWrapper) inputWrapper.style.display = '';
      const toggles = Neura.shadow.$('composer-toolbar');
      if (toggles) toggles.style.visibility = '';
      const input = Neura.shadow.$('message-input');
      if (input) input.placeholder = Neura.i18n.t('messagePlaceholder');

      Neura.session.setActiveChatId(chat.id, chat.title);
      if (Neura.chatSidebar) Neura.chatSidebar.refresh();
    },

    /** @deprecated Use createNewChat() */
    createURLSpecificChat() {
      Neura.session.createNewChat();
    },

    async loadChat(chatId) {
      if (!chatId) return;
      if (Neura.streaming?.isStreamActive?.()) {
        try {
          const chat = await Neura.localChats.get(chatId);
          if (chat) Neura.session.setActiveChatId(chatId, chat.title);
        } catch (_) {}
        return;
      }
      if (Neura.streaming?.abortActiveStream) Neura.streaming.abortActiveStream();
      if (Neura.notesPanel?.isActive?.()) Neura.notesPanel.close({ restoreChat: false });

      const previousId = Neura.session.getActiveChatId();
      if (previousId && previousId !== chatId) {
        await Neura.localChats.discardIfEmpty(previousId);
      }

      try {
        const synced = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ action: 'chats:get', localChatId: chatId }, resolve);
          } catch (e) {
            resolve(null);
          }
        });
        let chat = synced?.chat || (await Neura.localChats.get(chatId));
        if (!chat) throw new Error('Chat not found');

        const inputWrapper = Neura.shadow.$('input-wrapper');
        if (inputWrapper) inputWrapper.style.display = '';
        const toggles = Neura.shadow.$('composer-toolbar');
        if (toggles) toggles.style.visibility = '';
        const messageArea = Neura.shadow.$('message-area');
        if (messageArea) messageArea.classList.remove('notes-panel-active');
        const input = Neura.shadow.$('message-input');
        if (input) input.placeholder = Neura.i18n.t('messagePlaceholder');

        Neura.session.setActiveChatId(chatId, chat.title);
        renderMessages(chat.messages || []);
        if (!Neura.localChats.isEmpty(chat)) rememberChatForCurrentUrl(chatId);
        if (Neura.chatSidebar) Neura.chatSidebar.refresh();
      } catch (e) {
        console.warn('Neura: could not load chat', e);
      }
    },

    async deleteActiveChat() {
      const chatId = Neura.session.getActiveChatId();
      if (chatId) {
        try {
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'chats:delete', localChatId: chatId }, resolve);
          });
        } catch (e) {}
        await Neura.localChats.remove(chatId);
      }
      await Neura.session.createNewChat();
    },

    /** @deprecated */
    clearChatSession() {
      Neura.session.deleteActiveChat();
    },

    showDeleteConfirmation() {
      const shadowRoot = Neura.shadow.root();
      if (!shadowRoot) return;
      const chatWindow = shadowRoot.getElementById('chat-window');
      if (!chatWindow) return;

      const overlay = document.createElement('div');
      overlay.className = 'delete-confirmation-overlay';
      overlay.style.cssText = `
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(10px);
        display: flex; justify-content: center; align-items: center;
        animation: fadeIn 0.3s ease; z-index: 1000;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        background: white; padding: 24px; border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
        width: 85%; max-width: 400px; text-align: center;
        animation: slideIn 0.3s ease; border: 1px solid #e5e7eb;
      `;

      const title = document.createElement('h3');
      title.textContent = Neura.i18n.t('deleteConfirmTitle');
      title.style.cssText = `color: #1f2937; font-size: 1.2em; margin-bottom: 16px; font-weight: 700; font-family: 'Montserrat', sans-serif;`;
      modal.appendChild(title);

      const message = document.createElement('p');
      message.textContent = Neura.i18n.t('deleteConfirmChat');
      message.style.cssText = `color: #6b7280; margin-bottom: 24px; line-height: 1.5; white-space: pre-line;`;
      modal.appendChild(message);

      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = `display: flex; gap: 12px; justify-content: center;`;

      const cancelButton = document.createElement('button');
      cancelButton.textContent = Neura.i18n.t('cancel');
      cancelButton.style.cssText = `
        padding: 10px 20px; border: 1px solid #d1d5db; border-radius: 6px;
        background: white; color: #374151; cursor: pointer; font-weight: 500;
        font-family: 'Montserrat', sans-serif; transition: all 0.2s ease;
      `;
      cancelButton.addEventListener('click', () => chatWindow.removeChild(overlay));

      const deleteButton = document.createElement('button');
      deleteButton.textContent = Neura.i18n.t('deleteChat');
      deleteButton.style.cssText = `
        padding: 10px 20px; border: none; border-radius: 6px;
        background: #ef4444; color: white; cursor: pointer; font-weight: 600;
        font-family: 'Montserrat', sans-serif; transition: all 0.2s ease;
      `;
      deleteButton.addEventListener('click', async () => {
        await Neura.session.deleteActiveChat();
        chatWindow.removeChild(overlay);
      });

      buttonContainer.appendChild(cancelButton);
      buttonContainer.appendChild(deleteButton);
      modal.appendChild(buttonContainer);
      overlay.appendChild(modal);
      chatWindow.appendChild(overlay);
    },
  };

})(window.Neura);
