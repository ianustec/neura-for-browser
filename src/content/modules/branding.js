(function (Neura) {
  let pending = null;
  let lastApplied = null;

  function sendBrandingRequest(force) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'owui:getBranding', force: !!force }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) {
            resolve(null);
            return;
          }
          resolve(res);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function applyToBrandLogo(src, name) {
    const root = Neura.shadow?.root?.();
    if (!root || !src) return;
    const logoBtn = root.querySelector('.chat-sidebar-brand-logo');
    if (!logoBtn) return;

    logoBtn.textContent = '';
    let img = logoBtn.querySelector('img.chat-sidebar-brand-logo-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'chat-sidebar-brand-logo-img';
      img.alt = name || 'Neura';
      img.draggable = false;
      logoBtn.appendChild(img);
    }
    img.src = src;
    img.alt = name || 'Neura';

    const titleEl = root.querySelector('.chat-sidebar-brand-title');
    if (titleEl && name) titleEl.textContent = name;
  }

  /**
   * Refresh assistant avatars in the DOM.
   *
   * Each avatar carries the id of the model that produced *that* message in
   * `dataset.modelId` (set by `addMessageToChat`/streaming). Re-resolving
   * that same id keeps every past message's own icon correct instead of
   * blanket-overwriting the whole conversation with whatever model happens
   * to be active right now — which is what made icons appear to "change" or
   * "get lost" mid-conversation whenever branding refreshed (panel
   * open/close, SPA navigation, etc.). Only avatars that never resolved a
   * model id (created before any model was selected) fall back to `src`.
   * @param {string} src
   */
  function applyToAssistantAvatars(src) {
    const root = Neura.shadow?.root?.();
    if (!root) return;
    root.querySelectorAll('img.assistant-avatar').forEach((img) => {
      const modelId = img.dataset.modelId;
      if (modelId && Neura.modelIcons) {
        Neura.modelIcons.applyToImg(img, modelId);
        return;
      }
      if (src) img.src = src;
    });
  }

  Neura.branding = {
    /**
     * Fetch OWUI logo (cached in background) and apply to chat UI.
     * Extension toolbar/floating icons stay on the packaged asset.
     * @param {{ force?: boolean }} [opts]
     */
    async refresh(opts = {}) {
      if (pending && !opts.force) return pending;
      pending = (async () => {
        const branding = await sendBrandingRequest(opts.force);
        pending = null;
        if (!branding?.dataUrl && !branding?.url) return null;

        const src = branding.dataUrl || branding.url;
        lastApplied = { src, name: branding.name || null };
        Neura.paths = Neura.paths || {};
        Neura.paths.owuiLogo = src;

        applyToBrandLogo(src, branding.name);
        // Prefer the active model logo when already cached; otherwise instance branding.
        applyToAssistantAvatars(
          Neura.modelIcons?.getAssistantIconSrc?.() || src,
        );
        return lastApplied;
      })();
      return pending;
    },

    /** @returns {string} */
    getAssistantIconSrc() {
      return (
        Neura.modelIcons?.getAssistantIconSrc?.() ||
        Neura.paths?.owuiLogo ||
        Neura.paths?.iconWhite ||
        ''
      );
    },

    applyCached() {
      if (!lastApplied?.src) return;
      applyToBrandLogo(lastApplied.src, lastApplied.name);
      applyToAssistantAvatars(
        Neura.modelIcons?.getAssistantIconSrc?.() || lastApplied.src,
      );
    },
  };
})(window.Neura);
