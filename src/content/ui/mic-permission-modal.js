(function (Neura) {
  const MESSAGE_SOURCE = 'neura-mic-permission';
  let pendingResolve = null;
  let messageListener = null;

  function extensionOrigin() {
    return new URL(chrome.runtime.getURL('')).origin;
  }

  function closeModal(overlay) {
    if (messageListener) {
      window.removeEventListener('message', messageListener);
      messageListener = null;
    }
    overlay?.remove();
  }

  function finish(result) {
    const resolve = pendingResolve;
    pendingResolve = null;
    if (resolve) resolve(!!result);
  }

  /**
   * Show inline mic permission UI in the current page (no new tab).
   * @returns {Promise<boolean>} true if microphone access was granted
   */
  function requestMicPermission() {
    if (pendingResolve) {
      return Promise.resolve(false);
    }

    const shadowRoot = Neura.shadow?.root?.();
    const chatWindow = shadowRoot?.getElementById('chat-window');
    if (!chatWindow) {
      return Promise.resolve(false);
    }

    const existing = chatWindow.querySelector('.neura-mic-permission-overlay');
    if (existing) existing.remove();

    return new Promise((resolve) => {
      pendingResolve = resolve;
      const extOrigin = extensionOrigin();

      const overlay = document.createElement('div');
      overlay.className = 'neura-mic-permission-overlay';

      const panel = document.createElement('div');
      panel.className = 'neura-mic-permission-panel';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'neura-mic-permission-close';
      closeBtn.setAttribute('aria-label', Neura.i18n.t('cancel'));
      closeBtn.textContent = '\u00d7';
      closeBtn.addEventListener('click', () => {
        closeModal(overlay);
        finish(false);
      });
      panel.appendChild(closeBtn);

      const iframe = document.createElement('iframe');
      iframe.className = 'neura-mic-permission-frame';
      iframe.title = Neura.i18n.t('micPermissionTitle');
      iframe.allow = 'microphone';
      iframe.src = chrome.runtime.getURL('src/permissions/mic-permission.html?embed=1');
      panel.appendChild(iframe);

      overlay.appendChild(panel);
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) {
          closeModal(overlay);
          finish(false);
        }
      });

      messageListener = (ev) => {
        if (ev.origin !== extOrigin) return;
        const data = ev.data;
        if (!data || data.source !== MESSAGE_SOURCE) return;

        if (data.granted) {
          chrome.storage.local.set({ neuraMicGranted: true, neuraMicDenied: false });
          closeModal(overlay);
          finish(true);
          return;
        }

        if (data.denied) {
          chrome.storage.local.set({ neuraMicGranted: false, neuraMicDenied: true });
          closeModal(overlay);
          finish(false);
        }
      };
      window.addEventListener('message', messageListener);

      chatWindow.appendChild(overlay);
    });
  }

  Neura.micPermission = {
    requestMicPermission,
  };
})(window.Neura);
