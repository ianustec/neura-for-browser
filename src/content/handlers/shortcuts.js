(function (Neura) {
  // Registered before Neura.keyboard.install() so it runs first on the window's
  // capture phase: keyboard-isolation.js calls stopImmediatePropagation() for
  // keydown events originating inside our shadow DOM, which would otherwise
  // prevent this listener from firing when focus is on our own UI.
  function handleKeydown(ev) {
    if (ev.altKey || ev.metaKey || ev.shiftKey) return;

    if (ev.ctrlKey && ev.code === 'Space') {
      ev.preventDefault();
      ev.stopPropagation();
      Neura.shortcuts.openNewChat();
      return;
    }
  }

  Neura.shortcuts = {
    install() {
      window.addEventListener('keydown', handleKeydown, { capture: true });
    },

    openNewChat() {
      const chatContainer = Neura.shadow.host();
      const shadowRoot = chatContainer && chatContainer.shadowRoot;
      if (!shadowRoot) return;

      const iconWrapper = shadowRoot.getElementById('gptew-icon-wrapper');
      if (iconWrapper && iconWrapper.classList.contains('collapsed')) {
        Neura.chat.toggleChatWindowEventHandler();
      }

      if (Neura.session && typeof Neura.session.createNewChat === 'function') {
        Neura.session.createNewChat();
      }
    },

    isChatOpen() {
      const chatContainer = Neura.shadow.host();
      const shadowRoot = chatContainer && chatContainer.shadowRoot;
      if (!shadowRoot) return false;
      const iconWrapper = shadowRoot.getElementById('gptew-icon-wrapper');
      return !!iconWrapper && !iconWrapper.classList.contains('collapsed');
    },
  };
})(window.Neura);
