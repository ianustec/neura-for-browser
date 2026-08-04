(function (Neura) {
  let focusMonitoringInterval = null;
  let _mouseDownHandler = null;
  let _mouseUpHandler = null;

  function startFocusMonitoring() {
    if (focusMonitoringInterval) clearInterval(focusMonitoringInterval);

    if (!_mouseDownHandler) {
      _mouseDownHandler = (e) => {
        const path = e.composedPath();
        window.chatMouseDown = path.some((n) => n && n.id === 'gptew-chat-container');
      };
      _mouseUpHandler = () => {
        window.chatMouseDown = false;
      };
      document.addEventListener('mousedown', _mouseDownHandler, true);
      document.addEventListener('mouseup', _mouseUpHandler, true);
    }

    focusMonitoringInterval = setInterval(() => {
      const shadowRoot = Neura.shadow.root();
      if (!shadowRoot) return;
      const messageInput = shadowRoot.getElementById('message-input');
      const chatWindow = shadowRoot.getElementById('chat-window');
      const isChatOpen = chatWindow && chatWindow.classList.contains('open');
      if (!isChatOpen || !messageInput) {
        stopFocusMonitoring();
        return;
      }

      const messageInEditMode = shadowRoot.querySelector('.message.edit-mode');
      const editInput = shadowRoot.querySelector('.edit-input');
      if (messageInEditMode || editInput) return;

      if (shadowRoot.activeElement !== messageInput) {
        if (Date.now() < Neura.state.suppressFocusUntil) return;
        const activeEl = shadowRoot.activeElement;
        const settingsOpen = !!shadowRoot.querySelector('.chat-settings-overlay');
        const agentConfirm = !!shadowRoot.querySelector('.neura-agent-confirm-overlay');
        const micPermissionOpen = !!shadowRoot.querySelector('.neura-mic-permission-overlay');
        // `activeEl` already comes from `shadowRoot.activeElement`, so it is
        // always inside our own shadow tree — but "#gptew-chat-container" is
        // the *light-DOM host* that owns that shadow root, never one of its
        // shadow-internal ancestors, so `closest()` could never match and
        // this flag was always false. That meant every editable field other
        // than message-input (sidebar search, notes title/editor, settings
        // inputs, …) got its focus yanked back to message-input on the next
        // tick. Any focused editable element inside our UI is proof enough
        // the user is deliberately typing there.
        const interactingInChat =
          !!activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.isContentEditable);
        const mouseDownInChat = !!window.chatMouseDown;
        let selectingInMessages = false;
        const selection = window.getSelection && window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const messageArea = shadowRoot.getElementById('message-area');
          if (messageArea) {
            if (messageArea.contains(range.startContainer) || messageArea.contains(range.endContainer)) {
              selectingInMessages = true;
            }
          }
        }
        const recentlyInteractedInMessages =
          Date.now() - Neura.state.lastMessageAreaInteractionAt < 1500 ||
          Date.now() - Neura.state.lastMessageAreaScrollAt < 1500;

        const docActive = document.activeElement;
        const pageInputFocused =
          docActive &&
          docActive.id !== 'gptew-chat-container' &&
          (docActive.tagName === 'INPUT' ||
            docActive.tagName === 'TEXTAREA' ||
            docActive.isContentEditable);

        if (
          !(
            settingsOpen ||
            agentConfirm ||
            micPermissionOpen ||
            interactingInChat ||
            mouseDownInChat ||
            selectingInMessages ||
            recentlyInteractedInMessages ||
            pageInputFocused
          )
        ) {
          messageInput.focus();
        }
      }
    }, 150);
  }

  function stopFocusMonitoring() {
    if (focusMonitoringInterval) {
      clearInterval(focusMonitoringInterval);
      focusMonitoringInterval = null;
    }
    if (_mouseDownHandler) {
      document.removeEventListener('mousedown', _mouseDownHandler, true);
      document.removeEventListener('mouseup', _mouseUpHandler, true);
      _mouseDownHandler = null;
      _mouseUpHandler = null;
      window.chatMouseDown = false;
    }
  }

  function focusMessageInput() {
    const input = Neura.shadow.$('message-input');
    if (input) input.focus();
  }

  function onChatClosed() {
    stopFocusMonitoring();
  }

  Neura.focus = { startFocusMonitoring, stopFocusMonitoring, focusMessageInput, onChatClosed };
})(window.Neura);
