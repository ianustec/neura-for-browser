(function (Neura) {
  /**
   * Horizontal resize for #chat-window via the left-edge handle.
   * Width lives only in memory (Neura.sidebarLayout.widthPx); resets on
   * site change / browser close when the content script reinjects.
   */
  function isMobileChat(chatWindow) {
    return !!(chatWindow && chatWindow.classList.contains('mobile'));
  }

  /**
   * @param {HTMLElement} chatWindow
   */
  function init(chatWindow) {
    if (!chatWindow || isMobileChat(chatWindow)) return;

    const handle = chatWindow.querySelector('#chat-resize-handle');
    if (!handle || handle.dataset.neuraResizeBound === '1') return;
    handle.dataset.neuraResizeBound = '1';
    handle.draggable = false;

    let active = false;
    /** @type {number | null} */
    let pointerId = null;

    const endResize = (e) => {
      if (!active) return;
      active = false;
      chatWindow.classList.remove('resizing');
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');

      if (pointerId != null) {
        try {
          handle.releasePointerCapture(pointerId);
        } catch (err) {
          /* ignore */
        }
        pointerId = null;
      }

      // Final page reflow after the user settles the panel width.
      if (Neura.sidebarLayout && typeof Neura.sidebarLayout.setWidth === 'function') {
        Neura.sidebarLayout.setWidth(Neura.sidebarLayout.widthPx);
      }

      if (e) e.preventDefault();
    };

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (isMobileChat(chatWindow)) return;

      active = true;
      pointerId = e.pointerId;
      chatWindow.classList.add('resizing');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      try {
        handle.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }

      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!active) return;
      const nextWidth = window.innerWidth - e.clientX;
      if (Neura.sidebarLayout && typeof Neura.sidebarLayout.setWidth === 'function') {
        Neura.sidebarLayout.setWidth(nextWidth);
      }
      e.preventDefault();
    });

    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
    handle.addEventListener('lostpointercapture', endResize);
    handle.addEventListener('dragstart', (e) => e.preventDefault());
  }

  Neura.panelResize = { init };
})(window.Neura);
