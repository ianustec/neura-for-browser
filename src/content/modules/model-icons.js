(function (Neura) {
  /** @type {Map<string, string>} modelId → dataUrl */
  const cache = new Map();
  /** @type {Map<string, Promise<string|null>>} */
  const inflight = new Map();
  let activeModelId = '';

  function sendRequest(modelId, profileImageUrl) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            action: 'owui:getModelProfileImage',
            modelId,
            profileImageUrl: profileImageUrl || null,
          },
          (res) => {
            if (chrome.runtime.lastError || !res?.ok || !res.dataUrl) {
              resolve(null);
              return;
            }
            resolve(res.dataUrl);
          },
        );
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * @param {string} modelId
   * @param {string|null|undefined} [profileImageUrl]
   * @returns {Promise<string|null>}
   */
  function resolve(modelId, profileImageUrl) {
    const id = String(modelId || '').trim();
    if (!id) return Promise.resolve(null);
    if (cache.has(id)) return Promise.resolve(cache.get(id));
    if (inflight.has(id)) return inflight.get(id);

    const p = sendRequest(id, profileImageUrl).then((dataUrl) => {
      inflight.delete(id);
      if (dataUrl) cache.set(id, dataUrl);
      return dataUrl;
    });
    inflight.set(id, p);
    return p;
  }

  /**
   * Fill an <img> with the model logo when ready; leave src untouched on failure.
   * @param {HTMLImageElement|null|undefined} img
   * @param {string} modelId
   * @param {string|null|undefined} [profileImageUrl]
   */
  function applyToImg(img, modelId, profileImageUrl) {
    if (!img || !modelId) return;
    img.dataset.modelId = modelId;
    const cached = cache.get(modelId);
    if (cached) {
      img.src = cached;
      return;
    }
    resolve(modelId, profileImageUrl).then((src) => {
      if (!src) return;
      if (img.dataset.modelId !== modelId) return;
      img.src = src;
    });
  }

  Neura.modelIcons = {
    resolve,
    getCached(modelId) {
      return cache.get(String(modelId || '').trim()) || null;
    },
    setActiveModel(modelId) {
      activeModelId = String(modelId || '').trim();
    },
    getActiveModel() {
      return activeModelId;
    },
    /**
     * Icon for new assistant messages: active model logo → OWUI branding → packaged icon.
     * @returns {string}
     */
    getAssistantIconSrc() {
      if (activeModelId && cache.has(activeModelId)) return cache.get(activeModelId);
      return Neura.paths?.owuiLogo || Neura.paths?.iconWhite || '';
    },
    applyToImg,
    /**
     * Prefetch the active model icon and optionally refresh message avatars that
     * still show the generic branding fallback.
     * @param {string} modelId
     * @param {string|null|undefined} [profileImageUrl]
     */
    async refreshActive(modelId, profileImageUrl) {
      const id = String(modelId || '').trim();
      if (!id) return null;
      activeModelId = id;
      const src = await resolve(id, profileImageUrl);
      if (!src) return null;
      return src;
    },
  };
})(window.Neura);
