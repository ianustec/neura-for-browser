/**
 * Temporary hide of Neura overlay for tab screenshots.
 * Does not toggle chat open state or sessionStorage.
 */
(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
  // Overlay only exists in the top frame.
  if (window !== window.top) return;

  const Neura = window.Neura || {};
  const HOST_ID = 'gptew-chat-container';

  let refCount = 0;
  /** @type {{ hadSidebarOpen: boolean, hostVisibility: string, hostPointerEvents: string }|null} */
  let snapshot = null;

  function dlog(...args) {
    Neura.debug?.dlog?.('screenshot', ...args);
  }

  function dwarn(...args) {
    Neura.debug?.dwarn?.('screenshot', ...args);
  }

  /**
   * Wait for two animation frames so visibility/layout paint before capture.
   * @returns {Promise<void>}
   */
  function waitForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  /**
   * @returns {Promise<{ ok: boolean, depth?: number, error?: string }>}
   */
  async function prepare() {
    refCount += 1;
    dlog('capturePrepare', { depth: refCount });

    if (refCount === 1) {
      const host = document.getElementById(HOST_ID);
      const layoutSnap =
        Neura.sidebarLayout && typeof Neura.sidebarLayout.beginCaptureLayout === 'function'
          ? Neura.sidebarLayout.beginCaptureLayout()
          : { hadSidebarOpen: false };

      snapshot = {
        hadSidebarOpen: !!layoutSnap.hadSidebarOpen,
        hostVisibility: host ? host.style.visibility : '',
        hostPointerEvents: host ? host.style.pointerEvents : '',
      };

      if (host) {
        host.style.visibility = 'hidden';
        host.style.pointerEvents = 'none';
      } else {
        dwarn('capturePrepare: host missing');
      }
    }

    await waitForPaint();
    return { ok: true, depth: refCount };
  }

  /**
   * @returns {Promise<{ ok: boolean, depth?: number }>}
   */
  async function restore() {
    if (refCount <= 0) {
      dlog('captureRestore: already idle');
      return { ok: true, depth: 0 };
    }

    refCount -= 1;
    dlog('captureRestore', { depth: refCount });

    if (refCount === 0 && snapshot) {
      const host = document.getElementById(HOST_ID);
      if (host) {
        host.style.visibility = snapshot.hostVisibility || '';
        host.style.pointerEvents = snapshot.hostPointerEvents || '';
      }
      if (Neura.sidebarLayout && typeof Neura.sidebarLayout.endCaptureLayout === 'function') {
        Neura.sidebarLayout.endCaptureLayout({ hadSidebarOpen: snapshot.hadSidebarOpen });
      } else {
        document.documentElement.removeAttribute('data-neura-capturing');
      }
      snapshot = null;
      await waitForPaint();
    }

    return { ok: true, depth: refCount };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || (msg.type !== 'neura:capturePrepare' && msg.type !== 'neura:captureRestore')) {
      return false;
    }

    const extId = chrome.runtime.id;
    if (!sender.id || sender.id !== extId) {
      sendResponse({ ok: false, error: 'invalid sender' });
      return false;
    }

    const run = msg.type === 'neura:capturePrepare' ? prepare : restore;
    Promise.resolve()
      .then(() => run())
      .then((result) => sendResponse(result))
      .catch((e) => {
        dwarn(msg.type, 'failed', e);
        sendResponse({ ok: false, error: String(e?.message || e) });
      });
    return true;
  });

  Neura.captureMode = { prepare, restore };
  window.Neura = Neura;
})();
