(function (Neura) {
  const SIDEBAR_OPEN_KEY = 'neuraSidebarOpen';

  let currentChatId = null;
  let currentChatTitle = 'New Chat';
  let generatingChatIds = new Set();
  let cachedIndex = [];
  /** @type {'home'|'folder'|'notes'} */
  let sidebarMode = 'home';
  /** @type {'chat'|'search'|'notes'} */
  let activeNav = 'chat';
  let searchOpen = false;
  /** @type {{ id: string, name: string, parentId?: string|null }|null} */
  let currentFolder = null;
  /** @type {Array<{ id: string, name: string, parentId?: string|null }>} */
  let folderStack = [];
  /** @type {object[]} */
  let cachedFolders = [];
  let activeMenu = null;
  let pinnedSectionOpen = false;
  let lastSearchQuery = '';
  let searchDebounceTimer = null;
  const SEARCH_DEBOUNCE_MS = 300;

  /**
   * Renders `text` into `el`, wrapping the first case-insensitive match of
   * `query` in a <mark> so results stand out — same idea as WhatsApp's
   * message search or Ctrl+F in a PDF.
   */
  function renderTitleWithHighlight(el, text, query) {
    const value = text || '';
    const q = String(query || '').trim();
    if (!q) {
      el.textContent = value;
      return;
    }
    const idx = value.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) {
      el.textContent = value;
      return;
    }
    el.textContent = '';
    el.appendChild(document.createTextNode(value.slice(0, idx)));
    const mark = document.createElement('mark');
    mark.className = 'chat-sidebar-search-highlight';
    mark.textContent = value.slice(idx, idx + q.length);
    el.appendChild(mark);
    el.appendChild(document.createTextNode(value.slice(idx + q.length)));
  }
  const PINNED_OPEN_KEY = 'neuraPinnedSectionOpen';
  const SECTION_OPEN_KEYS = {
    folders: 'neuraSidebarSectionOpen_folders',
    chats: 'neuraSidebarSectionOpen_chats',
  };
  /** @type {{ folders: boolean, chats: boolean }} */
  let sectionOpen = {
    folders: false,
    chats: false,
  };
  let sidebarListGeneration = 0;

  function isLatestSidebarRender(gen) {
    return gen === sidebarListGeneration;
  }

  function beginSidebarRender() {
    sidebarListGeneration += 1;
    return sidebarListGeneration;
  }

  function sendAction(action, extra = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action, ...extra }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  /**
   * Normalizes a raw Open WebUI chat list item (from pinned/archived/search/
   * folder endpoints) into the same display shape as listUnifiedChats().
   * @param {object} raw
   */
  function toDisplayItem(raw) {
    const remoteId = raw.id || raw.chat_id || null;
    return {
      id: null,
      remoteId,
      title: raw.title || Neura.i18n.t('newChat'),
      updatedAt: normalizeTimestamp(raw.updated_at || raw.timestamp || 0),
      syncStatus: 'cloud-only',
      source: 'remote',
      pinned: !!raw.pinned,
      archived: !!raw.archived,
    };
  }

  function closeActiveMenu() {
    if (activeMenu) {
      activeMenu.remove();
      activeMenu = null;
    }
  }
  document.addEventListener('click', (e) => {
    if (activeMenu && !activeMenu.contains(e.target)) closeActiveMenu();
  });

  function folderParentId(folder) {
    return folder?.parent_id ?? folder?.parentId ?? null;
  }

  function childrenOf(folders, parentId) {
    const pid = parentId || null;
    return (folders || []).filter((f) => String(folderParentId(f) || '') === String(pid || ''));
  }

  function extractLeadingEmoji(title) {
    const raw = String(title || '').trim();
    if (!raw) return { emoji: '💬', text: raw };
    const match = raw.match(
      /^(\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*)\s*/u,
    );
    if (match) {
      return { emoji: match[1], text: raw.slice(match[0].length).trim() || raw };
    }
    return { emoji: '💬', text: raw };
  }

  /** Local chats use ms; OWUI often uses seconds. Do not divide true ms values. */
  function normalizeTimestamp(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n > 1e16) return Math.floor(n / 1e6); // ns → ms
    if (n > 1e14) return Math.floor(n / 1e3); // µs → ms
    if (n < 1e11) return Math.floor(n * 1000); // s → ms
    return Math.floor(n); // already ms
  }

  function formatRelativeTime(ts) {
    const ms = normalizeTimestamp(ts);
    if (!ms) return '';
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    try {
      return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  function updateNavActiveState() {
    const nav = Neura.shadow.$('chat-sidebar-nav');
    if (!nav) return;
    nav.querySelectorAll('.chat-sidebar-nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === activeNav);
    });
  }

  function setSearchOpen(open) {
    searchOpen = open;
    activeNav = open ? 'search' : 'chat';
    const wrap = Neura.shadow.$('chat-sidebar-search-wrap');
    const input = Neura.shadow.$('chat-sidebar-search');
    if (wrap) wrap.hidden = !open;
    if (input && open) {
      input.focus();
    } else if (input && !open) {
      input.value = '';
    }
    if (!open) lastSearchQuery = '';
    updateNavActiveState();
    if (!open) Neura.chatSidebar.refresh();
  }

  function persistSectionOpen(sectionId, open) {
    const key = SECTION_OPEN_KEYS[sectionId];
    if (!key) return;
    sectionOpen[sectionId] = !!open;
    try {
      chrome.storage.local.set({ [key]: !!open });
    } catch (e) {
      /* ignore */
    }
  }

  function buildFolderPathLabel(folder, folders) {
    const parts = [];
    let cur = folder;
    const byId = new Map((folders || []).map((f) => [f.id, f]));
    const guard = new Set();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      parts.unshift(cur.name || 'Folder');
      const pid = folderParentId(cur);
      cur = pid ? byId.get(pid) : null;
    }
    return parts.join(' / ');
  }

  function expandSidebarIfCollapsed() {
    const panel = Neura.shadow.$('chat-sidebar-panel');
    if (panel?.classList.contains('collapsed') && Neura.chatSidebar?.show) {
      Neura.chatSidebar.show();
    }
  }

  function userInitials(user) {
    const name = String(user?.name || user?.email || '').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return '?';
  }

  function renderRailUserFooter(footer) {
    if (!footer) return;
    footer.innerHTML = '';
    try {
      chrome.runtime.sendMessage({ action: 'auth:getUser' }, (res) => {
        const user = res?.user;
        const userRow = document.createElement('div');
        userRow.className = 'chat-sidebar-rail-user-row';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-sidebar-rail-user';
        btn.title = user?.name || user?.email || Neura.i18n.t('settingsAccountTitle');
        btn.innerHTML = `
          <span class="chat-sidebar-rail-user-avatar">
            ${userInitials(user)}
            <span class="chat-sidebar-rail-user-dot" aria-hidden="true"></span>
          </span>`;
        btn.addEventListener('click', () => {
          if (Neura.settings?.showSettingsOverlay) Neura.settings.showSettingsOverlay();
        });

        const poweredLink = document.createElement('a');
        poweredLink.className = 'chat-sidebar-powered-by';
        poweredLink.href = 'https://www.ianustec.com/';
        poweredLink.target = '_blank';
        poweredLink.rel = 'noopener noreferrer';
        poweredLink.title = Neura.i18n.t('poweredByLinkTitle');
        poweredLink.setAttribute(
          'aria-label',
          `${Neura.i18n.t('poweredByLabel')} ${Neura.i18n.t('poweredByBrand')}`,
        );
        poweredLink.innerHTML = `
          <span class="chat-sidebar-powered-by-label">${Neura.i18n.t('poweredByLabel')}</span>
          <span class="chat-sidebar-powered-by-brand">${Neura.i18n.t('poweredByBrand')}</span>`;
        poweredLink.addEventListener('click', (e) => e.stopPropagation());

        userRow.appendChild(btn);
        userRow.appendChild(poweredLink);
        footer.appendChild(userRow);
      });
    } catch (e) {
      /* ignore */
    }
  }

  function createCollapsibleSection({ sectionId, label, open = false, className = '' } = {}) {
    const wrap = document.createElement('div');
    wrap.className = `chat-sidebar-collapsible${className ? ` ${className}` : ''}`;
    if (sectionId) wrap.dataset.section = sectionId;
    wrap.dataset.open = open ? 'true' : 'false';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'chat-sidebar-collapsible-toggle';
    toggle.innerHTML = `
      <span class="chat-sidebar-collapsible-chevron" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </span>
      <span class="chat-sidebar-collapsible-label">${label}</span>`;

    const body = document.createElement('div');
    body.className = 'chat-sidebar-collapsible-body';

    toggle.addEventListener('click', () => {
      const next = wrap.dataset.open !== 'true';
      wrap.dataset.open = next ? 'true' : 'false';
      if (sectionId === 'pinned') {
        pinnedSectionOpen = next;
        try {
          chrome.storage.local.set({ [PINNED_OPEN_KEY]: next });
        } catch (e) {
          /* ignore */
        }
      } else if (sectionId) {
        persistSectionOpen(sectionId, next);
      }
    });

    wrap.appendChild(toggle);
    wrap.appendChild(body);
    return { wrap, body };
  }

  function appendPinnedCollapsible(list, pinnedChats) {
    if (!pinnedChats.length) return;

    const { wrap, body } = createCollapsibleSection({
      sectionId: 'pinned',
      label: Neura.i18n.t('pinnedChats'),
      open: pinnedSectionOpen,
      className: 'chat-sidebar-nested-collapsible',
    });

    for (const chat of pinnedChats) {
      body.appendChild(Neura.chatSidebar.renderChatItem(chat));
    }

    list.appendChild(wrap);
  }

  function pinnedChatKeys(pinnedChats) {
    const keys = new Set();
    for (const p of pinnedChats) {
      if (p.id) keys.add(`local:${p.id}`);
      if (p.remoteId) keys.add(`remote:${p.remoteId}`);
    }
    return keys;
  }

  function isPinnedChat(chat, keys) {
    if (chat.pinned) return true;
    if (chat.id && keys.has(`local:${chat.id}`)) return true;
    if (chat.remoteId && keys.has(`remote:${chat.remoteId}`)) return true;
    return false;
  }

  function mountContextMenu(anchorBtn, buildItems) {
    closeActiveMenu();
    const menu = document.createElement('div');
    menu.className = 'chat-sidebar-item-menu';

    const addItem = (label, onClick, opts = {}) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-sidebar-item-menu-btn';
      if (opts.danger) btn.classList.add('danger');
      btn.textContent = label;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeActiveMenu();
        await onClick();
      });
      menu.appendChild(btn);
    };

    buildItems(addItem);

    const chatWindow = Neura.shadow.$('chat-window');
    if (chatWindow?.dataset?.theme) {
      menu.dataset.theme = chatWindow.dataset.theme;
    }
    const mountRoot = Neura.shadow.root() || document.body;
    mountRoot.appendChild(menu);
    const rect = anchorBtn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, rect.right - 200)}px`;
    activeMenu = menu;
  }

  Neura.chatSidebar = {
    /**
     * Resets the left-rail nav back to the normal chat list. Called when the
     * notes editor is closed via its "Indietro" button, so the "Note" tab
     * doesn't stay highlighted/active once the user has left that section.
     *
     * Also re-renders #chat-sidebar-list right away: without this, the list
     * kept showing whatever was drawn last (the notes list) until some
     * unrelated event happened to call refresh() later (a new message, a
     * socket sync, …) — which is why the chat list seemed to randomly
     * disappear for a while, or forever if nothing else triggered a refresh.
     */
    exitNotesMode() {
      if (activeNav !== 'notes' && sidebarMode !== 'notes') return;
      activeNav = 'chat';
      sidebarMode = 'home';
      updateNavActiveState();
      this.refresh();
    },

    /** Debounced live search as the user types (input event). */
    handleSearchTyping(value) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        const q = String(value || '').trim();
        if (q) this.search(q);
        else this.refresh();
      }, SEARCH_DEBOUNCE_MS);
    },

    /** Enter key: search immediately, skipping the debounce. */
    submitSearch(value) {
      clearTimeout(searchDebounceTimer);
      const q = String(value || '').trim();
      if (q) this.search(q);
      else this.refresh();
    },

    getActiveChatId() {
      return currentChatId;
    },

    getActiveChatTitle() {
      return currentChatTitle;
    },

    setActiveChatId(id, title) {
      currentChatId = id || null;
      if (title) currentChatTitle = title;
      else if (!id) currentChatTitle = Neura.i18n.t('newChat');
      this.highlightActive();
      this.updateHeaderTitle();
      if (id) {
        Neura.localChats.get(id).then((chat) => {
          if (id === currentChatId) this.renderHeaderTags(chat?.tags);
        }).catch(() => {});
      } else {
        this.renderHeaderTags([]);
      }
    },

    updateHeaderTitle() {
      const titleEl = Neura.shadow.$('chat-title');
      if (titleEl) titleEl.textContent = currentChatTitle || Neura.i18n.t('newChat');
    },

    renderHeaderTags(tags) {
      const container = Neura.shadow.$('chat-title-tags');
      if (!container) return;
      container.innerHTML = '';
      const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
      if (list.length === 0) {
        container.hidden = true;
        return;
      }
      for (const tag of list) {
        const chip = document.createElement('span');
        chip.className = 'chat-title-tag';
        chip.textContent = `#${tag}`;
        container.appendChild(chip);
      }
      container.hidden = false;
    },

    highlightActive() {
      const list = Neura.shadow.$('chat-sidebar-list');
      if (!list) return;
      list.querySelectorAll('.chat-sidebar-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.chatId === currentChatId);
      });
    },

    setGenerating(chatId, active) {
      if (!chatId) return;
      if (active) generatingChatIds.add(chatId);
      else generatingChatIds.delete(chatId);
      const list = Neura.shadow.$('chat-sidebar-list');
      if (!list) return;
      const item = list.querySelector(`.chat-sidebar-item[data-chat-id="${chatId}"]`);
      if (item) item.classList.toggle('generating', active);

      const header = Neura.shadow.$('header-wrapper');
      if (header && chatId === currentChatId) {
        header.classList.toggle('generating', active);
      }
    },

    mount(container) {
      if (!container || container.querySelector('#chat-sidebar-panel')) return;

      const panel = document.createElement('div');
      panel.id = 'chat-sidebar-panel';
      panel.className = 'chat-sidebar-panel';
      // Start collapsed for a cleaner first paint; user can open via toggle.
      if (!Neura.state.sidebarOpen) panel.classList.add('collapsed');

      const header = document.createElement('div');
      header.className = 'chat-sidebar-header';

      const brandRow = document.createElement('div');
      brandRow.className = 'chat-sidebar-brand-row';

      const brandLogo = document.createElement('button');
      brandLogo.type = 'button';
      brandLogo.className = 'chat-sidebar-brand-logo chat-sidebar-brand-toggle';
      brandLogo.setAttribute('aria-label', Neura.i18n.t('toggleSidebar'));
      brandLogo.title = Neura.i18n.t('toggleSidebar');
      // Placeholder until OWUI branding loads (see Neura.branding.refresh).
      brandLogo.innerHTML =
        '<img class="chat-sidebar-brand-logo-img" alt="Neura" draggable="false" />';
      const placeholderImg = brandLogo.querySelector('img');
      if (placeholderImg) placeholderImg.src = Neura.paths?.icon || Neura.paths?.iconWhite || '';
      brandLogo.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Neura.chatSidebar?.toggle) Neura.chatSidebar.toggle();
      });

      const brandText = document.createElement('div');
      brandText.className = 'chat-sidebar-brand-text';
      brandText.innerHTML = `<span class="chat-sidebar-brand-title">NEURA | IANUSTEC</span><span class="chat-sidebar-brand-subtitle">Open WebUI</span>`;

      brandRow.appendChild(brandLogo);
      brandRow.appendChild(brandText);

      const nav = document.createElement('nav');
      nav.id = 'chat-sidebar-nav';
      nav.className = 'chat-sidebar-nav';
      nav.setAttribute('aria-label', Neura.i18n.t('toggleSidebar'));

      const navItems = [
        {
          id: 'chat',
          label: Neura.i18n.t('newChat'),
          icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
        },
        {
          id: 'search',
          label: Neura.i18n.t('navSearch'),
          icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
        },
        {
          id: 'notes',
          label: Neura.i18n.t('tabNotes'),
          icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`,
        },
      ];

      for (const item of navItems) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-sidebar-nav-item';
        btn.dataset.nav = item.id;
        btn.innerHTML = `<span class="chat-sidebar-nav-icon">${item.icon}</span><span class="chat-sidebar-nav-label">${item.label}</span>`;
        btn.addEventListener('click', () => {
          if (item.id === 'chat') {
            activeNav = 'chat';
            sidebarMode = 'home';
            currentFolder = null;
            folderStack = [];
            setSearchOpen(false);
            if (Neura.notesPanel?.isActive?.()) Neura.notesPanel.close({ restoreChat: false });
            Neura.session.createNewChat();
            updateNavActiveState();
            return;
          }
          if (item.id === 'search') {
            expandSidebarIfCollapsed();
            setSearchOpen(!searchOpen);
            return;
          }
          if (item.id === 'notes') {
            expandSidebarIfCollapsed();
            activeNav = 'notes';
            sidebarMode = 'notes';
            setSearchOpen(false);
            updateNavActiveState();
            if (Neura.notesPanel) Neura.notesPanel.open(null);
            this.refresh();
          }
        });
        nav.appendChild(btn);
      }

      const searchWrap = document.createElement('div');
      searchWrap.id = 'chat-sidebar-search-wrap';
      searchWrap.className = 'chat-sidebar-search-wrap';
      searchWrap.hidden = true;

      const searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.className = 'chat-sidebar-search';
      searchInput.id = 'chat-sidebar-search';
      searchInput.placeholder = Neura.i18n.t('searchChats');
      // Typing/Enter on this field are handled from keyboard-isolation.js:
      // global keydown/input listeners there call stopImmediatePropagation()
      // on every keystroke inside our shadow DOM (to keep the host page's
      // own shortcuts from firing), which also prevents a listener attached
      // directly on this input from ever running. See
      // Neura.chatSidebar.handleSearchTyping/submitSearch below.
      searchWrap.appendChild(searchInput);

      header.appendChild(brandRow);
      header.appendChild(nav);
      header.appendChild(searchWrap);

      const list = document.createElement('div');
      list.id = 'chat-sidebar-list';
      list.className = 'chat-sidebar-list';

      const railFooter = document.createElement('div');
      railFooter.className = 'chat-sidebar-rail-footer';
      renderRailUserFooter(railFooter);

      panel.appendChild(header);
      panel.appendChild(list);
      panel.appendChild(railFooter);
      container.insertBefore(panel, container.firstChild);

      updateNavActiveState();
      const storageKeys = [PINNED_OPEN_KEY, ...Object.values(SECTION_OPEN_KEYS)];
      try {
        chrome.storage.local.get(storageKeys, (data) => {
          if (typeof data?.[PINNED_OPEN_KEY] === 'boolean') {
            pinnedSectionOpen = data[PINNED_OPEN_KEY];
          }
          for (const [sectionId, key] of Object.entries(SECTION_OPEN_KEYS)) {
            if (typeof data?.[key] === 'boolean') {
              sectionOpen[sectionId] = data[key];
            }
          }
          this.refresh();
        });
      } catch (e) {
        this.refresh();
      }
    },

    openArchivedMenu(anchorBtn, chat, container, onClose) {
      mountContextMenu(anchorBtn, (addItem) => {
        addItem(Neura.i18n.t('unarchiveChat'), async () => {
          const res = await sendAction('chats:archive', {
            localChatId: chat.id,
            remoteId: chat.remoteId,
          });
          if (res.ok) {
            await this.renderArchivedInto(container, onClose);
            this.refresh();
          } else if (res.error === 'not_synced') {
            alert(Neura.i18n.t('chatNotSyncedYet'));
          } else {
            alert(res.error || Neura.i18n.t('chatNotSyncedYet'));
          }
        });

        addItem(
          Neura.i18n.t('deleteChat'),
          async () => {
            if (!confirm(Neura.i18n.t('deleteConfirmChat'))) return;
            const res = await sendAction('chats:delete', {
              localChatId: chat.id,
              remoteId: chat.remoteId,
            });
            if (chat.id) {
              try {
                await Neura.localChats.remove(chat.id);
              } catch (e) {}
              if (chat.id === currentChatId) await Neura.session.createNewChat();
            }
            if (res.ok) {
              await this.renderArchivedInto(container, onClose);
              this.refresh();
            } else {
              alert(res.error || Neura.i18n.t('deleteConfirmChat'));
            }
          },
          { danger: true },
        );
      });
    },

    openMenu(anchorBtn, chat) {
      const remoteId = chat.remoteId || null;
      const localId = chat.id || null;

      mountContextMenu(anchorBtn, (addItem) => {
        addItem(chat.pinned ? Neura.i18n.t('unpinChat') : Neura.i18n.t('pinChat'), async () => {
          const res = await sendAction('chats:pin', { localChatId: localId, remoteId });
          if (res.ok) this.refresh();
          else if (res.error === 'not_synced') alert(Neura.i18n.t('chatNotSyncedYet'));
        });

        addItem(
          chat.archived ? Neura.i18n.t('unarchiveChat') : Neura.i18n.t('archiveChat'),
          async () => {
            const res = await sendAction('chats:archive', { localChatId: localId, remoteId });
            if (res.ok) this.refresh();
            else if (res.error === 'not_synced') alert(Neura.i18n.t('chatNotSyncedYet'));
          },
        );

        addItem(Neura.i18n.t('duplicateChat'), async () => {
          const baseTitle = chat.title || Neura.i18n.t('newChat');
          const title = Neura.i18n.t('copyOfChat', baseTitle);
          const res = await sendAction('chats:duplicate', {
            localChatId: localId,
            remoteId,
            title,
          });
          if (res.ok) this.refresh();
          else if (res.error === 'not_synced') alert(Neura.i18n.t('chatNotSyncedYet'));
          else alert(res.error || Neura.i18n.t('chatNotSyncedYet'));
        });

        addItem(Neura.i18n.t('shareChat'), async () => {
          const res = await sendAction('chats:share', { localChatId: localId, remoteId });
          if (res.ok && res.url) {
            try {
              await navigator.clipboard.writeText(res.url);
              alert(Neura.i18n.t('shareLinkCopied'));
            } catch (e) {
              alert(res.url);
            }
          } else if (res.error === 'not_synced') {
            alert(Neura.i18n.t('chatNotSyncedYet'));
          } else {
            alert(res.error || Neura.i18n.t('chatNotSyncedYet'));
          }
        });

        addItem(Neura.i18n.t('moveToFolder'), async () => {
          await this.promptMoveChatToFolder(localId, remoteId);
        });
      });
    },

    async promptMoveChatToFolder(localId, remoteId) {
      const folders = await sendAction('folders:list').then((r) => (r.ok ? r.items : []));
      cachedFolders = folders;
      const labeled = folders
        .map((f) => ({
          folder: f,
          label: buildFolderPathLabel(f, folders),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const names = labeled.map((x) => x.label).join('\n');
      const answer = prompt(
        `${Neura.i18n.t('moveToFolderPrompt')}${names ? `\n\n${names}` : ''}`,
      );
      if (answer === null) return;
      const trimmed = answer.trim();
      if (!trimmed) {
        const res = await sendAction('chats:moveToFolder', {
          localChatId: localId,
          remoteId,
          folderId: null,
        });
        if (!res.ok) {
          if (res.error === 'not_synced') alert(Neura.i18n.t('chatNotSyncedYet'));
          else alert(res.error || Neura.i18n.t('chatNotSyncedYet'));
        }
        this.refresh();
        return;
      }

      let match = labeled.find((x) => x.label.toLowerCase() === trimmed.toLowerCase());
      if (!match) {
        match = labeled.find((x) => String(x.folder.name || '').toLowerCase() === trimmed.toLowerCase());
      }
      let folder = match?.folder || null;
      if (!folder) {
        // Allow creating nested path while moving, e.g. "test/test1"
        const created = await sendAction('folders:createPath', {
          path: trimmed,
          parentId: null,
        });
        folder = created.folder;
      }
      if (folder?.id) {
        const res = await sendAction('chats:moveToFolder', {
          localChatId: localId,
          remoteId,
          folderId: folder.id,
        });
        if (!res.ok) {
          if (res.error === 'not_synced') alert(Neura.i18n.t('chatNotSyncedYet'));
          else alert(res.error || Neura.i18n.t('chatNotSyncedYet'));
        }
      }
      this.refresh();
    },

    openFolderMenu(anchorBtn, folder) {
      mountContextMenu(anchorBtn, (addItem) => {
        addItem(Neura.i18n.t('duplicateFolder'), async () => {
          const res = await sendAction('folders:duplicate', { folderId: folder.id });
          if (!res.ok) alert(res.error || Neura.i18n.t('duplicateFolderError'));
          this.refresh();
        });

        addItem(Neura.i18n.t('renameFolder'), async () => {
          const name = prompt(Neura.i18n.t('renameFolderPrompt'), folder.name || '');
          if (!name || !name.trim()) return;
          const res = await sendAction('folders:update', {
            folderId: folder.id,
            name: name.trim(),
          });
          if (!res.ok) alert(res.error || Neura.i18n.t('renameFolderError'));
          this.refresh();
        });

        addItem(Neura.i18n.t('newSubfolder'), async () => {
          const name = prompt(Neura.i18n.t('newSubfolderPrompt'));
          if (!name || !name.trim()) return;
          const res = await sendAction('folders:createPath', {
            path: name.trim(),
            parentId: folder.id,
          });
          if (!res.ok) alert(res.error || Neura.i18n.t('newFolderError'));
          this.refresh();
        });

        addItem(Neura.i18n.t('moveFolder'), async () => {
          const folders = cachedFolders.length
            ? cachedFolders
            : await sendAction('folders:list').then((r) => (r.ok ? r.items : []));
          const labeled = folders
            .filter((f) => f.id !== folder.id)
            .map((f) => ({ folder: f, label: buildFolderPathLabel(f, folders) }))
            .sort((a, b) => a.label.localeCompare(b.label));
          const names = labeled.map((x) => x.label).join('\n');
          const answer = prompt(
            `${Neura.i18n.t('moveFolderPrompt')}${names ? `\n\n${names}` : ''}`,
          );
          if (answer === null) return;
          const trimmed = answer.trim();
          let parentId = null;
          if (trimmed) {
            const match =
              labeled.find((x) => x.label.toLowerCase() === trimmed.toLowerCase()) ||
              labeled.find((x) => String(x.folder.name || '').toLowerCase() === trimmed.toLowerCase());
            if (!match) {
              alert(Neura.i18n.t('folderNotFound'));
              return;
            }
            parentId = match.folder.id;
          }
          const res = await sendAction('folders:move', {
            folderId: folder.id,
            parentId,
          });
          if (!res.ok) alert(res.error || Neura.i18n.t('moveFolderError'));
          this.refresh();
        });

        addItem(
          Neura.i18n.t('deleteFolder'),
          async () => {
            if (!confirm(Neura.i18n.t('deleteFolderConfirm'))) return;
            const res = await sendAction('folders:delete', {
              folderId: folder.id,
              deleteContents: false,
            });
            if (!res.ok) alert(res.error || Neura.i18n.t('deleteFolderError'));
            if (currentFolder?.id === folder.id) {
              currentFolder = folderStack.length ? folderStack[folderStack.length - 1] : null;
              folderStack = folderStack.slice(0, -1);
            }
            this.refresh();
          },
          { danger: true },
        );
      });
    },

    renderChatItem(chat) {
      const id = chat.id;
      const remoteId = chat.remoteId || null;
      const title = chat.title || Neura.i18n.t('newChat');
      const { emoji, text } = extractLeadingEmoji(title);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'chat-sidebar-item';
      item.dataset.chatId = id || '';
      if (remoteId) item.dataset.remoteId = remoteId;
      if (generatingChatIds.has(id)) item.classList.add('generating');

      const leading = document.createElement('span');
      leading.className = 'chat-sidebar-item-leading';

      const statusDot = document.createElement('span');
      statusDot.className = 'chat-sidebar-status-dot';
      const showDot =
        generatingChatIds.has(id) ||
        chat.syncStatus === 'pending' ||
        chat.syncStatus === 'error';
      statusDot.hidden = !showDot;
      leading.appendChild(statusDot);

      const emojiSpan = document.createElement('span');
      emojiSpan.className = 'chat-sidebar-item-emoji';
      emojiSpan.textContent = emoji;
      leading.appendChild(emojiSpan);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'chat-sidebar-item-title';
      renderTitleWithHighlight(titleSpan, text || title, lastSearchQuery);

      if (chat.syncStatus && chat.syncStatus !== 'synced') {
        titleSpan.title =
          chat.syncStatus === 'cloud-only'
            ? 'Cloud'
            : chat.syncStatus === 'pending'
              ? Neura.i18n.t('syncRetryTitle')
              : chat.syncStatus;
      }

      const timeSpan = document.createElement('span');
      timeSpan.className = 'chat-sidebar-item-time';
      timeSpan.textContent = formatRelativeTime(chat.updatedAt);

      const actions = document.createElement('span');
      actions.className = 'chat-sidebar-item-actions';

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'chat-sidebar-menu-btn';
      menuBtn.title = Neura.i18n.t('chatOptions');
      menuBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeMenu) {
          closeActiveMenu();
          return;
        }
        this.openMenu(menuBtn, chat);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'chat-sidebar-delete-btn';
      deleteBtn.title = Neura.i18n.t('deleteChatSidebar');
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(Neura.i18n.t('deleteConfirmChat'))) return;
        if (id) {
          try {
            await new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: 'chats:delete', localChatId: id }, resolve);
            });
          } catch (err) {}
          await Neura.localChats.remove(id);
          if (id === currentChatId) await Neura.session.createNewChat();
        }
        Neura.chatSidebar.refresh();
      });

      actions.appendChild(menuBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(leading);
      item.appendChild(titleSpan);
      item.appendChild(timeSpan);
      item.appendChild(actions);

      item.addEventListener('click', async () => {
        activeNav = 'chat';
        sidebarMode = 'home';
        updateNavActiveState();
        if (id) {
          Neura.session.loadChat(id);
        } else if (remoteId) {
          const res = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage({ action: 'chats:get', remoteId }, resolve);
            } catch (e) {
              resolve(null);
            }
          });
          if (res?.ok && res.localId) {
            await Neura.session.loadChat(res.localId);
          }
        }
        const panel = Neura.shadow.$('chat-sidebar-panel');
        const chatWindow = Neura.shadow.$('chat-window');
        if (panel && chatWindow?.classList.contains('mobile')) {
          panel.classList.add('collapsed');
        }
      });

      if (id === currentChatId) item.classList.add('active');
      return item;
    },

    appendSection(list, label, className) {
      const section = document.createElement('div');
      section.className = className || 'chat-sidebar-section';
      section.textContent = label;
      list.appendChild(section);
      return section;
    },

    renderNoteRow(note) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'chat-sidebar-item chat-sidebar-note-item';
      item.dataset.noteId = note.id || '';
      item.classList.toggle('active', note.id && note.id === Neura.state.activeNoteId);

      const leading = document.createElement('span');
      leading.className = 'chat-sidebar-item-leading';
      const emojiSpan = document.createElement('span');
      emojiSpan.className = 'chat-sidebar-item-emoji';
      emojiSpan.textContent = '📝';
      leading.appendChild(emojiSpan);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'chat-sidebar-item-title';
      renderTitleWithHighlight(titleSpan, note.title || Neura.i18n.t('noteUntitled'), lastSearchQuery);

      const timeSpan = document.createElement('span');
      timeSpan.className = 'chat-sidebar-item-time';
      timeSpan.textContent = formatRelativeTime(note.updated_at || note.updatedAt);

      item.appendChild(leading);
      item.appendChild(titleSpan);
      item.appendChild(timeSpan);
      item.addEventListener('click', () => {
        activeNav = 'notes';
        sidebarMode = 'notes';
        updateNavActiveState();
        if (Neura.notesPanel) Neura.notesPanel.open(note.id);
        this.refresh();
      });
      return item;
    },

    async renderUnifiedHome(list, gen) {
      const [foldersRes, pinnedRes, unified] = await Promise.all([
        sendAction('folders:list'),
        sendAction('chats:pinnedList'),
        new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ action: 'chats:list' }, (res) => {
              if (chrome.runtime.lastError || !res?.ok) {
                Neura.localChats.list().then(resolve);
                return;
              }
              resolve(res.items || []);
            });
          } catch (e) {
            Neura.localChats.list().then(resolve);
          }
        }),
      ]);

      if (!isLatestSidebarRender(gen)) return;
      list.innerHTML = '';

      const folders = foldersRes.ok ? foldersRes.items || [] : [];
      const pinnedItems = (pinnedRes.ok ? pinnedRes.items || [] : [])
        .map((raw) => ({
          ...toDisplayItem(raw),
          pinned: true,
        }))
        .sort((a, b) => normalizeTimestamp(b.updatedAt) - normalizeTimestamp(a.updatedAt));
      const pinnedKeys = pinnedChatKeys(pinnedItems);
      cachedFolders = folders;
      cachedIndex = unified.filter((c) => !isPinnedChat(c, pinnedKeys));

      const foldersSec = createCollapsibleSection({
        sectionId: 'folders',
        label: Neura.i18n.t('tabFolders'),
        open: sectionOpen.folders,
        className: 'chat-sidebar-section-collapsible',
      });
      const topFolders = childrenOf(cachedFolders, null);
      if (topFolders.length) {
        for (const folder of topFolders) {
          foldersSec.body.appendChild(this.renderFolderItem(folder));
        }
      } else {
        const empty = document.createElement('div');
        empty.className = 'chat-sidebar-section-empty';
        empty.textContent = '—';
        foldersSec.body.appendChild(empty);
      }
      const newFolderBtn = document.createElement('button');
      newFolderBtn.type = 'button';
      newFolderBtn.className = 'chat-sidebar-inline-action';
      newFolderBtn.textContent = `+ ${Neura.i18n.t('newFolder')}`;
      newFolderBtn.addEventListener('click', () => this.promptCreateFolder(null));
      foldersSec.body.appendChild(newFolderBtn);
      list.appendChild(foldersSec.wrap);

      const chatsSec = createCollapsibleSection({
        sectionId: 'chats',
        label: Neura.i18n.t('tabChats'),
        open: sectionOpen.chats,
        className: 'chat-sidebar-section-collapsible',
      });

      appendPinnedCollapsible(chatsSec.body, pinnedItems);

      if (cachedIndex.length) {
        const sorted = [...cachedIndex].sort(
          (a, b) => normalizeTimestamp(b.updatedAt) - normalizeTimestamp(a.updatedAt),
        );
        for (const chat of sorted) {
          chatsSec.body.appendChild(this.renderChatItem(chat));
        }
      } else if (!pinnedItems.length) {
        this.renderEmptyState(chatsSec.body);
      }
      list.appendChild(chatsSec.wrap);
      this.highlightActive();
    },

    renderEmptyState(list, messageKey) {
      const empty = document.createElement('div');
      empty.className = 'chat-sidebar-empty';
      empty.textContent = Neura.i18n.t(messageKey || 'noChats');
      list.appendChild(empty);
    },

    updateNewButtonLabel() {
      /* legacy no-op: new chat lives in sidebar nav */
    },

    updateSearchPlaceholder() {
      const searchInput = Neura.shadow.$('chat-sidebar-search');
      if (!searchInput) return;
      searchInput.placeholder = Neura.i18n.t('searchChats');
    },

    renderNotesList(list, notes) {
      list.innerHTML = '';
      this.appendSection(list, Neura.i18n.t('tabNotes'), 'chat-sidebar-section chat-sidebar-section-label');
      if (!notes.length) {
        this.renderEmptyState(list, 'noNotes');
        return;
      }
      for (const note of notes) list.appendChild(this.renderNoteRow(note));
    },

    renderFolderItem(folder) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'chat-sidebar-item chat-sidebar-folder-item';

      const leading = document.createElement('span');
      leading.className = 'chat-sidebar-item-leading';
      const emojiSpan = document.createElement('span');
      emojiSpan.className = 'chat-sidebar-item-emoji';
      emojiSpan.textContent = '📁';
      leading.appendChild(emojiSpan);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'chat-sidebar-item-title';
      nameSpan.textContent = folder.name || 'Folder';

      const actions = document.createElement('span');
      actions.className = 'chat-sidebar-item-actions';

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'chat-sidebar-menu-btn';
      menuBtn.title = Neura.i18n.t('folderOptions');
      menuBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeMenu) {
          closeActiveMenu();
          return;
        }
        this.openFolderMenu(menuBtn, folder);
      });
      actions.appendChild(menuBtn);

      item.appendChild(leading);
      item.appendChild(nameSpan);
      item.appendChild(actions);
      item.addEventListener('click', () => {
        sidebarMode = 'folder';
        if (currentFolder) folderStack.push(currentFolder);
        currentFolder = {
          id: folder.id,
          name: folder.name,
          parentId: folderParentId(folder),
        };
        this.refresh();
      });
      return item;
    },

    async promptCreateFolder(parentId = null) {
      const name = prompt(Neura.i18n.t('newFolderPathPrompt'));
      if (!name || !name.trim()) return;
      const res = await sendAction('folders:createPath', {
        path: name.trim(),
        parentId: parentId || null,
      });
      if (!res.ok) alert(res.error || Neura.i18n.t('newFolderError'));
      this.refresh();
    },

    renderFoldersList(list, folders) {
      cachedFolders = folders || [];
      list.innerHTML = '';

      const parentId = currentFolder?.id || null;
      const sectionLabel = currentFolder
        ? `📁 ${[...folderStack.map((f) => f.name), currentFolder.name].join(' / ')}`
        : Neura.i18n.t('tabFolders');
      this.appendSection(list, sectionLabel);

      if (currentFolder) {
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'chat-sidebar-back-btn';
        const parentName = folderStack.length
          ? folderStack[folderStack.length - 1].name
          : Neura.i18n.t('tabFolders');
        backBtn.textContent = `← ${parentName}`;
        backBtn.addEventListener('click', () => {
          currentFolder = folderStack.length ? folderStack[folderStack.length - 1] : null;
          folderStack = folderStack.slice(0, -1);
          if (!currentFolder) sidebarMode = 'home';
          this.refresh();
        });
        list.appendChild(backBtn);
      }

      const newFolderBtn = document.createElement('button');
      newFolderBtn.type = 'button';
      newFolderBtn.className = 'chat-sidebar-new-folder-btn';
      newFolderBtn.textContent = currentFolder
        ? `+ ${Neura.i18n.t('newSubfolder')}`
        : `+ ${Neura.i18n.t('newFolder')}`;
      newFolderBtn.addEventListener('click', () => this.promptCreateFolder(parentId));
      list.appendChild(newFolderBtn);

      const childFolders = childrenOf(cachedFolders, parentId);
      for (const folder of childFolders) {
        list.appendChild(this.renderFolderItem(folder));
      }

      return childFolders;
    },

    async renderFolderContents(list, gen) {
      const foldersRes = await sendAction('folders:list');
      if (!isLatestSidebarRender(gen)) return;
      const folders = foldersRes.ok ? foldersRes.items || [] : [];
      const childFolders = this.renderFoldersList(list, folders);

      if (!currentFolder) {
        if (!childFolders.length) this.renderEmptyState(list, 'noFolders');
        return;
      }

      const chatsRes = await sendAction('folders:chats', { folderId: currentFolder.id });
      if (!isLatestSidebarRender(gen)) return;
      const items = (chatsRes.ok ? chatsRes.items : [])
        .map(toDisplayItem)
        .sort((a, b) => normalizeTimestamp(b.updatedAt) - normalizeTimestamp(a.updatedAt));
      cachedIndex = items;

      if (items.length) {
        this.appendSection(list, Neura.i18n.t('folderChatsSection'));
        for (const chat of items) list.appendChild(this.renderChatItem(chat));
      } else if (!childFolders.length) {
        this.renderEmptyState(list, 'noFolderContents');
      }
      this.highlightActive();
    },

    // Purely local storage read — cheap enough to call after every message
    // and socket event, no network round-trips involved.
    async refresh() {
      const list = Neura.shadow.$('chat-sidebar-list');
      if (!list) return;
      try {
        await Neura.localChats.pruneEmpty();
      } catch (e) {
        /* ignore */
      }
      const gen = beginSidebarRender();
      lastSearchQuery = '';
      this.updateSearchPlaceholder();
      updateNavActiveState();

      if (Neura.notesPanel?.isActive?.()) activeNav = 'notes';

      if (sidebarMode === 'notes' || activeNav === 'notes') {
        const res = await sendAction('notes:list');
        if (!isLatestSidebarRender(gen)) return;
        this.renderNotesList(list, res.ok ? res.items || [] : []);
        return;
      }

      if (sidebarMode === 'folder' && currentFolder) {
        await this.renderFolderContents(list, gen);
        return;
      }

      await this.renderUnifiedHome(list, gen);
    },

    async search(text) {
      const list = Neura.shadow.$('chat-sidebar-list');
      if (!list) return;
      const gen = beginSidebarRender();
      const q = String(text || '').trim().toLowerCase();
      lastSearchQuery = q;
      sidebarMode = 'home';

      const [notesRes, localSource] = await Promise.all([
        q ? sendAction('notes:search', { query: q }) : sendAction('notes:list'),
        cachedIndex.length
          ? Promise.resolve(cachedIndex)
          : new Promise((resolve) => {
              try {
                chrome.runtime.sendMessage({ action: 'chats:list' }, (res) => {
                  resolve(res?.ok ? res.items || [] : []);
                });
              } catch (e) {
                Neura.localChats.list().then(resolve);
              }
            }),
      ]);

      const localMatches = q
        ? localSource.filter((c) => (c.title || '').toLowerCase().includes(q))
        : localSource;

      let remoteMatches = [];
      if (q) {
        const res = await sendAction('chats:search', { text: q });
        if (res.ok) {
          const knownRemoteIds = new Set(localMatches.map((c) => c.remoteId).filter(Boolean));
          remoteMatches = (res.items || [])
            .filter((raw) => !knownRemoteIds.has(raw.id))
            .map(toDisplayItem);
        }
      }

      const chatMatches = [...localMatches, ...remoteMatches];
      const notes = (notesRes.ok ? notesRes.items || [] : []).filter((n) =>
        !q ? true : (n.title || '').toLowerCase().includes(q),
      );
      if (!isLatestSidebarRender(gen)) return;
      list.innerHTML = '';
      if (notes.length) {
        this.appendSection(list, Neura.i18n.t('tabNotes'), 'chat-sidebar-section chat-sidebar-section-label');
        for (const note of notes) list.appendChild(this.renderNoteRow(note));
      }
      this.appendSection(list, Neura.i18n.t('tabChats'), 'chat-sidebar-section chat-sidebar-section-label');
      if (!chatMatches.length) {
        this.renderEmptyState(list);
      } else {
        for (const chat of chatMatches) list.appendChild(this.renderChatItem(chat));
      }
      this.highlightActive();
    },

    updateChatTitle(chatId, title) {
      if (!title) return;
      if (chatId === currentChatId) {
        currentChatTitle = title;
        this.updateHeaderTitle();
      }
      const cached = cachedIndex.find((c) => c.id === chatId);
      if (cached) cached.title = title;
      const list = Neura.shadow.$('chat-sidebar-list');
      if (!list) return;
      const item = list.querySelector(`[data-chat-id="${chatId}"] .chat-sidebar-item-title`);
      if (item) item.textContent = title;
    },

    /**
     * Applies the title/tags Open WebUI generated server-side for a turn
     * (background_tasks.title_generation/tags_generation), delivered
     * out-of-band from the background service worker once the turn's
     * streaming port has already closed.
     * @param {string} chatId
     * @param {string} title
     * @param {string[]} tags
     */
    applyGeneratedMeta(chatId, title, tags) {
      if (title) this.updateChatTitle(chatId, title);
      if (chatId === currentChatId) this.renderHeaderTags(tags);
    },

    show() {
      const panel = Neura.shadow.$('chat-sidebar-panel');
      if (panel) panel.classList.remove('collapsed');
      Neura.state.sidebarOpen = true;
      try {
        chrome.storage.local.set({ [SIDEBAR_OPEN_KEY]: true });
      } catch (e) {}
    },

    hide() {
      const panel = Neura.shadow.$('chat-sidebar-panel');
      if (panel) panel.classList.add('collapsed');
      Neura.state.sidebarOpen = false;
      try {
        chrome.storage.local.set({ [SIDEBAR_OPEN_KEY]: false });
      } catch (e) {}
    },

    toggle() {
      const panel = Neura.shadow.$('chat-sidebar-panel');
      if (!panel) return;
      panel.classList.toggle('collapsed');
      const open = !panel.classList.contains('collapsed');
      Neura.state.sidebarOpen = open;
      try {
        chrome.storage.local.set({ [SIDEBAR_OPEN_KEY]: open });
      } catch (e) {}
    },

    async renderArchivedInto(container, onClose) {
      if (!container) return;
      container.innerHTML = `<div class="settings-archived-loading">${Neura.i18n.t('loading')}</div>`;
      const res = await sendAction('chats:archivedList');
      const items = (res.ok ? res.items || [] : []).map((raw) => ({
        ...toDisplayItem(raw),
        archived: true,
      }));
      container.innerHTML = '';
      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'settings-archived-empty';
        empty.textContent = Neura.i18n.t('noArchivedChats');
        container.appendChild(empty);
        return;
      }
      for (const chat of items) {
        const row = document.createElement('div');
        row.className = 'settings-archived-row';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'settings-archived-item';
        const { emoji, text } = extractLeadingEmoji(chat.title || Neura.i18n.t('newChat'));
        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'settings-archived-emoji';
        emojiSpan.textContent = emoji;
        const titleSpan = document.createElement('span');
        titleSpan.className = 'settings-archived-title';
        titleSpan.textContent = text;
        btn.appendChild(emojiSpan);
        btn.appendChild(titleSpan);
        btn.addEventListener('click', async () => {
          if (chat.id) {
            await Neura.session.loadChat(chat.id);
          } else if (chat.remoteId) {
            const loaded = await new Promise((resolve) => {
              try {
                chrome.runtime.sendMessage({ action: 'chats:get', remoteId: chat.remoteId }, resolve);
              } catch (e) {
                resolve(null);
              }
            });
            if (loaded?.ok && loaded.localId) await Neura.session.loadChat(loaded.localId);
          }
          if (typeof onClose === 'function') onClose();
        });

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'settings-archived-menu-btn';
        menuBtn.title = Neura.i18n.t('chatOptions');
        menuBtn.setAttribute('aria-label', Neura.i18n.t('chatOptions'));
        menuBtn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';
        menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (activeMenu) {
            closeActiveMenu();
            return;
          }
          this.openArchivedMenu(menuBtn, chat, container, onClose);
        });

        row.appendChild(btn);
        row.appendChild(menuBtn);
        container.appendChild(row);
      }
    },
  };

  // Best-effort early hydration so the correct item is already highlighted
  // if the sidebar renders before session.loadSessionMessages() runs.
  Neura.localChats.getActiveId().then((id) => {
    if (id) currentChatId = id;
  }).catch(() => {});

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.action === 'chat_meta_updated') {
        Neura.chatSidebar.applyGeneratedMeta(msg.chatId, msg.title, msg.tags);
        return false;
      }
      if (msg?.action === 'chats_synced') {
        Neura.chatSidebar.refresh?.();
        return false;
      }
      return false;
    });
  }
})(window.Neura);
