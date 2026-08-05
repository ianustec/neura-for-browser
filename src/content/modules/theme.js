(function (Neura) {
  const THEME_STORAGE_KEY = 'neuraThemeMode';
  const listeners = [];

  function resolveSystemTheme() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  function notifyListeners(resolved) {
    listeners.forEach((fn) => {
      try {
        fn(resolved);
      } catch (e) {
        /* ignore */
      }
    });
  }

  function applyResolvedTheme(resolved) {
    const chatWindow = Neura.shadow.$('chat-window');
    if (!chatWindow) return;
    chatWindow.dataset.theme = resolved;
    chatWindow.dataset.themeMode = Neura.state.themeMode;
    notifyListeners(resolved);
  }

  function applyTheme() {
    const resolved = Neura.state.themeMode === 'system' ? resolveSystemTheme() : Neura.state.themeMode;
    applyResolvedTheme(resolved);
  }

  function onSystemPreferenceChange() {
    if (Neura.state.themeMode === 'system') applyTheme();
  }

  Neura.theme = {
    async init() {
      // Reinitialize (e.g. after a UI language change rebuilds the whole
      // shadow DOM) must not pile up listeners bound to now-detached nodes.
      listeners.length = 0;

      let stored = null;
      try {
        stored = await new Promise((resolve) => {
          chrome.storage.sync.get(THEME_STORAGE_KEY, (data) => {
            resolve(chrome.runtime.lastError ? null : data?.[THEME_STORAGE_KEY] || null);
          });
        });
      } catch (e) {
        stored = null;
      }

      Neura.state.themeMode = stored === 'light' || stored === 'dark' ? stored : 'system';
      applyTheme();

      try {
        window
          .matchMedia('(prefers-color-scheme: dark)')
          .addEventListener('change', onSystemPreferenceChange);
      } catch (e) {
        /* ignore */
      }
    },

    apply: applyTheme,

    getMode() {
      return Neura.state.themeMode || 'system';
    },

    getResolved() {
      const mode = Neura.state.themeMode || 'system';
      return mode === 'system' ? resolveSystemTheme() : mode;
    },

    // Cycles between explicit light/dark (never back to "system" once the
    // user has made a manual choice from the toggle button).
    toggle() {
      const current = this.getResolved();
      const next = current === 'dark' ? 'light' : 'dark';
      Neura.state.themeMode = next;
      try {
        chrome.storage.sync.set({ [THEME_STORAGE_KEY]: next });
      } catch (e) {
        /* ignore */
      }
      applyResolvedTheme(next);
      return next;
    },

    onChange(fn) {
      if (typeof fn === 'function') listeners.push(fn);
    },
  };
})(window.Neura);
