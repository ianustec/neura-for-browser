(function (Neura) {
  const STYLE_ID = 'neura-sidebar-styles';
  const SPACER_ID = 'neura-sidebar-spacer';
  const HOST_ID = 'gptew-chat-container';

  function maxWidthPx() {
    const ratio =
      (Neura.constants && Neura.constants.MAX_CHAT_WIDTH_RATIO) || 0.9;
    return Math.floor(window.innerWidth * ratio);
  }

  function minWidthPx() {
    return (Neura.constants && Neura.constants.MIN_CHAT_WIDTH) || 200;
  }

  function clampWidth(px) {
    const n = Math.round(Number(px) || 0);
    return Math.max(minWidthPx(), Math.min(maxWidthPx(), n));
  }

  function isSidebarOpen() {
    return document.documentElement.classList.contains('neura-sidebar-open');
  }

  /**
   * Apps like Google Maps size canvases from container metrics on window
   * "resize". CSS alone is not enough — notify after the layout settles.
   * @param {{ thorough?: boolean }} [opts]
   */
  function notifyPageReflow(opts) {
    const thorough = !opts || opts.thorough !== false;
    const fire = () => {
      try {
        window.dispatchEvent(new Event('resize'));
      } catch (e) {
        /* ignore */
      }
      try {
        if (window.visualViewport) {
          window.visualViewport.dispatchEvent(new Event('resize'));
        }
      } catch (e) {
        /* ignore */
      }
    };
    fire();
    if (!thorough) return;
    requestAnimationFrame(() => {
      fire();
      setTimeout(fire, 50);
      setTimeout(fire, 300);
    });
  }

  Neura.sidebarLayout = {
    widthPx: Neura.constants.SIDEBAR_WIDTH_PX,
    _resizeListenerBound: false,
    _reflowTimer: null,

    /**
     * Some sites load their own CSS (or CSS-in-JS <style> tags) after we've
     * injected ours. When a competing rule has the same specificity and is
     * also `!important`, the browser breaks the tie by source order — so a
     * later stylesheet can silently win over ours and the page never
     * shrinks (it just renders full-bleed under our fixed panel instead).
     * Keeping our <style> as the very last node in the document, and
     * re-appending it whenever new style/link nodes show up, guarantees we
     * always win those ties without needing any per-site special-casing.
     */
    _keepStyleLast(styleEl) {
      if (this._styleReorderObserver) return;
      const reappend = () => {
        if (styleEl.parentNode !== document.documentElement || styleEl.nextSibling) {
          document.documentElement.appendChild(styleEl);
        }
      };
      let scheduled = false;
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          reappend();
        });
      };
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node === styleEl) continue;
            const tag = node.nodeName;
            if (
              tag === 'STYLE' ||
              (tag === 'LINK' && String(node.rel || '').toLowerCase().includes('stylesheet'))
            ) {
              schedule();
              return;
            }
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      this._styleReorderObserver = observer;
    },

    ensureGlobalStyles() {
      if (!document.getElementById(SPACER_ID)) {
        const spacer = document.createElement('div');
        spacer.id = SPACER_ID;
        spacer.setAttribute('aria-hidden', 'true');
        spacer.style.cssText = `
          position: fixed;
          top: 0;
          right: 0;
          width: 0;
          height: 100vh;
          height: 100dvh;
          transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          pointer-events: none;
          z-index: 1;
        `;
        document.documentElement.appendChild(spacer);
      }

      if (!document.getElementById(STYLE_ID)) {
        const globalStyle = document.createElement('style');
        globalStyle.id = STYLE_ID;
        globalStyle.textContent = `
          :root {
            --neura-sidebar-width: ${Neura.constants.SIDEBAR_WIDTH_PX}px;
          }

          /* Keep our host out of the page flow so shrinking body cannot trap it. */
          #${HOST_ID} {
            position: fixed !important;
            top: 0 !important;
            right: 0 !important;
            bottom: auto !important;
            left: auto !important;
            width: 0 !important;
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            z-index: 2147483646 !important;
          }

          /*
           * Shrink the page so nothing sits under the panel.
           * body becomes the containing block for absolute full-bleed apps
           * (Google Maps #app with inset:0), which otherwise use the viewport.
           * Selectors below repeat the ".neura-sidebar-open" class on purpose:
           * it raises specificity above typical single-class site rules
           * (e.g. "body.some-theme { width: 100vw !important }") so ours wins
           * even when both sides use !important, regardless of load order.
           */
          html.neura-sidebar-open.neura-sidebar-open {
            width: calc(100vw - var(--neura-sidebar-width)) !important;
            max-width: calc(100vw - var(--neura-sidebar-width)) !important;
            overflow-x: hidden !important;
            box-sizing: border-box !important;
          }
          html.neura-sidebar-open.neura-sidebar-open body {
            position: relative !important;
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            overflow-x: hidden !important;
            box-sizing: border-box !important;
          }
          html.neura-sidebar-open.neura-sidebar-open #root,
          html.neura-sidebar-open.neura-sidebar-open #app,
          html.neura-sidebar-open.neura-sidebar-open #app-container,
          html.neura-sidebar-open.neura-sidebar-open #content-container,
          html.neura-sidebar-open.neura-sidebar-open #__next,
          html.neura-sidebar-open.neura-sidebar-open [data-reactroot],
          html.neura-sidebar-open.neura-sidebar-open .widget-scene,
          html.neura-sidebar-open.neura-sidebar-open .widget-scene-canvas {
            max-width: 100% !important;
            box-sizing: border-box !important;
          }

          /*
           * Safety net for full-bleed hero/section wrappers that are direct
           * children of body: these are the elements that most commonly use
           * a fixed desktop width (or are sized off the *real* viewport, e.g.
           * a "100vw" hero) and therefore don't shrink from the body/html
           * width change above. Clipping them at the new (narrower) edge
           * keeps their content from rendering underneath our fixed panel;
           * anything that doesn't fit wraps or gets clipped by its own
           * overflow instead of visually mixing with the panel.
           */
          html.neura-sidebar-open.neura-sidebar-open body > * {
            max-width: 100% !important;
            box-sizing: border-box !important;
            overflow-x: hidden !important;
          }

          /* Opt-out for fragile sites that set data-neura-no-resize on <html>. */
          html[data-neura-no-resize].neura-sidebar-open,
          html[data-neura-no-resize].neura-sidebar-open body,
          html[data-neura-no-resize].neura-sidebar-open body > * {
            width: 100vw !important;
            max-width: 100vw !important;
            position: static !important;
            overflow-x: visible !important;
          }

          /* Screenshot capture: instant full-bleed, no spacer animation flash. */
          html[data-neura-capturing] #${SPACER_ID} {
            transition: none !important;
            width: 0 !important;
          }
        `;
        document.documentElement.appendChild(globalStyle);
        this._keepStyleLast(globalStyle);
      }

      this._applyCssVars(this.widthPx);
      this._ensureResizeListener();
    },

    _applyCssVars(px) {
      document.documentElement.style.setProperty('--neura-sidebar-width', `${px}px`);
      const chatWindow = Neura.shadow && Neura.shadow.$('chat-window');
      if (chatWindow) {
        chatWindow.style.setProperty('--neura-panel-width', `${px}px`);
      }
      const spacer = document.getElementById(SPACER_ID);
      if (spacer) {
        spacer.style.width = isSidebarOpen() ? `${px}px` : '0px';
      }
    },

    /**
     * Update panel + page-reflow width. Not persisted across sites / browser sessions.
     * @param {number} px
     */
    setWidth(px) {
      const next = clampWidth(px);
      this.widthPx = next;
      this.ensureGlobalStyles();
      this._applyCssVars(next);
      if (isSidebarOpen()) {
        // Debounce during drag-resize so Maps is not flooded with events.
        if (this._reflowTimer) clearTimeout(this._reflowTimer);
        this._reflowTimer = setTimeout(() => {
          this._reflowTimer = null;
          notifyPageReflow({ thorough: true });
        }, 120);
      }
      return next;
    },

    /** Re-clamp current width against the viewport (e.g. after window resize). */
    clampToViewport() {
      return this.setWidth(this.widthPx);
    },

    _ensureResizeListener() {
      if (this._resizeListenerBound) return;
      this._resizeListenerBound = true;
      window.addEventListener('resize', () => {
        if (this.widthPx > maxWidthPx() || this.widthPx < minWidthPx()) {
          this.clampToViewport();
        }
      });
    },

    /**
     * Open/closed state for the floating chat panel.
     * Stored in sessionStorage so it survives refresh of this tab+origin, but
     * a brand-new tab/page always starts closed (empty sessionStorage).
     */
    _openKey() {
      return 'neura_chat_panel_open';
    },

    persistOpen(isOpen) {
      try {
        sessionStorage.setItem(this._openKey(), isOpen ? '1' : '0');
      } catch (e) {
        /* private mode / blocked storage */
      }
    },

    readOpen() {
      return new Promise((resolve) => {
        try {
          const raw = sessionStorage.getItem(this._openKey());
          // Absent key → new page/tab → closed. Only an explicit '1' restores open.
          resolve(raw === '1');
        } catch (e) {
          resolve(false);
        }
      });
    },

    setOpen(isOpen, isMobile) {
      this.ensureGlobalStyles();
      if (isMobile) {
        document.body.classList.remove('neura-sidebar-open');
        document.documentElement.classList.remove('neura-sidebar-open');
        this._applyCssVars(this.widthPx);
        notifyPageReflow();
        return;
      }
      if (isOpen) {
        document.body.classList.add('neura-sidebar-open');
        document.documentElement.classList.add('neura-sidebar-open');
      } else {
        document.body.classList.remove('neura-sidebar-open');
        document.documentElement.classList.remove('neura-sidebar-open');
      }
      this._applyCssVars(this.widthPx);
      notifyPageReflow();
    },

    /**
     * Temporarily restore full-bleed page layout for screenshots.
     * Does not touch chat open classes or sessionStorage.
     * @returns {{ hadSidebarOpen: boolean }}
     */
    beginCaptureLayout() {
      this.ensureGlobalStyles();
      const hadSidebarOpen = isSidebarOpen();
      document.documentElement.setAttribute('data-neura-capturing', '1');
      if (hadSidebarOpen) {
        document.body.classList.remove('neura-sidebar-open');
        document.documentElement.classList.remove('neura-sidebar-open');
        this._applyCssVars(this.widthPx);
        notifyPageReflow({ thorough: false });
      }
      return { hadSidebarOpen };
    },

    /**
     * Undo beginCaptureLayout.
     * @param {{ hadSidebarOpen?: boolean }|null|undefined} snapshot
     */
    endCaptureLayout(snapshot) {
      document.documentElement.removeAttribute('data-neura-capturing');
      if (snapshot?.hadSidebarOpen) {
        document.body.classList.add('neura-sidebar-open');
        document.documentElement.classList.add('neura-sidebar-open');
        this._applyCssVars(this.widthPx);
        notifyPageReflow({ thorough: false });
      } else {
        this._applyCssVars(this.widthPx);
      }
    },
  };
})(window.Neura);
