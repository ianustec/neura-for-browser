(function (Neura) {
  async function createGPTEWChat() {
    if (Neura.i18n) await Neura.i18n.init();

    const chatContainer = document.createElement('div');
    chatContainer.id = 'gptew-chat-container';
    document.body.appendChild(chatContainer);

    Neura.sidebarLayout.ensureGlobalStyles();

    const shadowRoot = chatContainer.attachShadow({ mode: 'open' });
    if (Neura.i18n) Neura.i18n.applyToShadowRoot(shadowRoot);

    const style = document.createElement('style');
    try {
      const [baseCss, owuiCss] = await Promise.all([
        fetch(chrome.runtime.getURL('styles.css')).then((r) => r.text()),
        fetch(chrome.runtime.getURL('styles-owui.css')).then((r) => r.text()),
      ]);
      style.textContent = baseCss + '\n' + owuiCss;
    } catch (error) {
      style.textContent = `
        #gptew-icon-wrapper { position: fixed; bottom: 70px; right: 20px; z-index: 999999; }
        #gptew-icon-toggle { width: 64px; height: 64px; border-radius: 50%;
          background: linear-gradient(135deg, #4338ca 0%, #7c3aed 50%, #a21caf 100%); cursor: pointer; }
      `;
    }
    shadowRoot.appendChild(style);

    const iconWrapper = document.createElement('div');
    iconWrapper.id = 'gptew-icon-wrapper';
    iconWrapper.classList.add('collapsed');

    const chatIcon = document.createElement('img');
    chatIcon.id = 'gptew-icon-toggle';
    chatIcon.src = Neura.paths.icon;
    chatIcon.style.cssText = `cursor: pointer;`;
    chatIcon.draggable = false;

    const messagesWindows = Neura.ui.createMessagesWindow();

    iconWrapper.appendChild(chatIcon);
    shadowRoot.appendChild(iconWrapper);
    shadowRoot.appendChild(messagesWindows);

    const chatWindow = shadowRoot.getElementById('chat-window');
    if (chatWindow && Neura.sidebarLayout) {
      Neura.sidebarLayout.setWidth(Neura.constants.SIDEBAR_WIDTH_PX);
    }
    if (chatWindow && Neura.panelResize) {
      Neura.panelResize.init(chatWindow);
    }

    if (Neura.iconDrag) {
      Neura.iconDrag.applyStoredPosition(iconWrapper);
      Neura.iconDrag.makeDraggable(iconWrapper, chatIcon, {
        onClick: () => Neura.chat.toggleChatWindowEventHandler(),
      });
    }

    if (Neura.branding?.refresh) {
      Neura.branding.refresh().catch(() => {});
    }
  }

  function toggleChatWindowEventHandler() {
    const chatContainer = Neura.shadow.host();
    if (!chatContainer) return;
    const shadowRoot = chatContainer.shadowRoot;
    if (!shadowRoot) return;
    const iconWrapper = shadowRoot.getElementById('gptew-icon-wrapper');
    const chatWindow = shadowRoot.getElementById('chat-window');

    chrome.runtime.sendMessage({ action: 'auth:status' }, (status) => {
      if (chrome.runtime.lastError || !status?.loggedIn) {
        Neura.settings.showSettingsOverlay();
      } else {
        if (Neura.ui?.refreshHeaderModelSelect) {
          Neura.ui.refreshHeaderModelSelect().catch(() => {});
        }
        if (!Neura.state.sessionMessagesLoaded) {
          Neura.session.loadSessionMessages();
          Neura.state.sessionMessagesLoaded = true;
        } else if (Neura.turnRejoin && !Neura.turnRejoin.isActive()) {
          Neura.turnRejoin.tryRejoin().catch(() => {});
        }
      }
    });

    const isMobile = chatWindow.classList.contains('mobile');
    const backdrop = shadowRoot.getElementById('chat-backdrop');

    if (iconWrapper.classList.contains('collapsed')) {
      iconWrapper.classList.remove('collapsed');
      chatWindow.classList.add('open');
      // Cleaner first view: chat history starts closed; user can reopen it.
      if (Neura.chatSidebar) Neura.chatSidebar.hide();
      Neura.sidebarLayout.setOpen(true, isMobile);
      Neura.sidebarLayout.persistOpen(true);
      if (backdrop) {
        backdrop.style.opacity = '0';
        backdrop.style.pointerEvents = 'none';
      }
      setTimeout(() => {
        const messageInput = shadowRoot.getElementById('message-input');
        if (messageInput) {
          messageInput.focus();
          Neura.focus.startFocusMonitoring();
        }
      }, 300);
    } else {
      chatWindow.classList.remove('open');
      iconWrapper.classList.add('collapsed');
      Neura.sidebarLayout.setOpen(false, isMobile);
      Neura.sidebarLayout.persistOpen(false);
      if (backdrop) {
        backdrop.style.opacity = '0';
        backdrop.style.pointerEvents = 'none';
      }
      Neura.focus.onChatClosed();
    }
  }

  function forceOpenSidebar() {
    const chatContainer = Neura.shadow.host();
    const shadowRoot = chatContainer && chatContainer.shadowRoot;
    if (!shadowRoot) return;
    const iconWrapper = shadowRoot.getElementById('gptew-icon-wrapper');
    const chatWindow = shadowRoot.getElementById('chat-window');
    if (!iconWrapper || !chatWindow) return;
    if (!iconWrapper.classList.contains('collapsed')) return;
    iconWrapper.classList.remove('collapsed');
    chatWindow.classList.add('open');
    const isMobile = chatWindow.classList.contains('mobile');
    Neura.sidebarLayout.setOpen(true, isMobile);
    Neura.sidebarLayout.persistOpen(true);
  }

  async function bootstrapAfterCreate() {
    try {
      // Active turn is scoped to this tabId (survives refresh, not new tabs).
      if (Neura.turnRejoin) {
        const status = await Neura.turnRejoin.queryActiveTurn();
        if (status && status.active) {
          forceOpenSidebar();
          if (!Neura.state.sessionMessagesLoaded) {
            await Neura.session.loadSessionMessages();
            Neura.state.sessionMessagesLoaded = true;
          }
          if (!Neura.turnRejoin.isActive()) {
            await Neura.turnRejoin.tryRejoin();
          }
          return;
        }
      }

      // Restore open/closed from this tab's session (refresh → same; new page → closed).
      const wasOpen = await Neura.sidebarLayout.readOpen();
      if (!wasOpen) return;

      forceOpenSidebar();

      if (Neura.turnRejoin) {
        const draft = await Neura.session.getAssistantDraft();
        if (draft && draft.partial) {
          if (!Neura.state.sessionMessagesLoaded) {
            await Neura.session.loadSessionMessages();
            Neura.state.sessionMessagesLoaded = true;
          } else {
            await Neura.turnRejoin.tryRehydrateDraft();
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  function resetToolOverridesForFreshLoad() {
    try {
      chrome.runtime.sendMessage({ action: 'owui:resetToolOverrides' }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      /* ignore */
    }
  }

  function initializeChat() {
    const shadowHost = document.getElementById('gptew-chat-container');
    if (window === window.top && !shadowHost) {
      // A full page load/refresh must always start from the model's original
      // OWUI-configured tools, discarding any ad-hoc picker edits from before.
      resetToolOverridesForFreshLoad();
      createGPTEWChat().then(bootstrapAfterCreate);
    }
  }

  async function reinitialize() {
    if (window !== window.top) return;
    const existing = document.getElementById('gptew-chat-container');
    if (existing) existing.remove();
    if (Neura.state) Neura.state.sessionMessagesLoaded = false;
    resetToolOverridesForFreshLoad();
    if (Neura.i18n) await Neura.i18n.init();
    await createGPTEWChat();
    await bootstrapAfterCreate();
  }

  Neura.chat = { toggleChatWindowEventHandler, initializeChat, reinitialize };

  // Install modules that must run in all frames
  if (Neura.frameAggregation) Neura.frameAggregation.install();

  // Top-frame only: install keyboard isolation + bootstrap chat
  if (window === window.top) {
    try {
      if (Neura.shortcuts) Neura.shortcuts.install();
      Neura.keyboard.install();
    } catch (e) {
      /* ignore */
    }
    window.addEventListener('load', initializeChat);
    const flush = () => {
      try {
        if (Neura.session && Neura.session.flushAssistantDraftSync) {
          Neura.session.flushAssistantDraftSync();
        }
      } catch (e) {}
    };
    window.addEventListener('pagehide', flush, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
})(window.Neura);
