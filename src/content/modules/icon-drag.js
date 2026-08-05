(function (Neura) {
  /**
   * Floating launcher (#gptew-icon-wrapper).
   *
   * Resting position is always expressed as distance from the viewport's
   * right and bottom edges (CSS `right` + `bottom`). Those preferred insets
   * stay constant across resizes, so the icon moves with the corner and never
   * falls outside the visible area. If the viewport becomes smaller than the
   * preferred insets, they are clamped for rendering only; the preferred
   * values are kept so enlarging the window restores the original distance.
   *
   * Interaction: short tap opens chat; long press / drag moves the icon.
   */
  const STORAGE_KEY = 'neura_icon_position';
  const MARGIN = 8;
  const DEFAULT_RIGHT = 20;
  const DEFAULT_BOTTOM = 70;
  const FALLBACK_ICON_SIZE = 56;
  const DRAG_THRESHOLD = 6;
  const LONG_PRESS_MS = 400;
  const TAP_MAX_MOVE = 10;

  /** @type {HTMLElement | null} */
  let boundWrapper = null;
  /** Preferred insets (not clamped). @type {{ right: number, bottom: number }} */
  let preferred = { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM };
  /** @type {ReturnType<typeof setTimeout> | null} */
  let resizeTimer = null;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /** @param {HTMLElement} iconWrapper */
  function measureSize(iconWrapper) {
    const rect = iconWrapper.getBoundingClientRect();
    const w = rect.width || FALLBACK_ICON_SIZE;
    const h = rect.height || FALLBACK_ICON_SIZE;
    return { w, h };
  }

  /**
   * Normalize current dual-edge, legacy single-edge, and right/bottom formats.
   * @param {object|null|undefined} raw
   * @returns {{ right: number, bottom: number }}
   */
  function normalizePos(raw) {
    if (!raw || typeof raw !== 'object') {
      return { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM };
    }

    if (Number.isFinite(Number(raw.right)) && Number.isFinite(Number(raw.bottom))) {
      return {
        right: Math.max(MARGIN, Number(raw.right)),
        bottom: Math.max(MARGIN, Number(raw.bottom)),
      };
    }

    // Previous dual-edge format → convert to right/bottom via current viewport.
    if (raw.hEdge && raw.vEdge) {
      const { w, h } = boundWrapper
        ? measureSize(boundWrapper)
        : { w: FALLBACK_ICON_SIZE, h: FALLBACK_ICON_SIZE };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const hInset = Math.max(MARGIN, Number(raw.hInset) || MARGIN);
      const vInset = Math.max(MARGIN, Number(raw.vInset) || MARGIN);
      const left = raw.hEdge === 'left' ? hInset : vw - w - hInset;
      const top = raw.vEdge === 'top' ? vInset : vh - h - vInset;
      return {
        right: Math.max(MARGIN, vw - left - w),
        bottom: Math.max(MARGIN, vh - top - h),
      };
    }

    // Legacy single-edge snap.
    if (raw.edge) {
      const { w, h } = boundWrapper
        ? measureSize(boundWrapper)
        : { w: FALLBACK_ICON_SIZE, h: FALLBACK_ICON_SIZE };
      const offset = Number(raw.offset);
      const off = Number.isFinite(offset) ? Math.max(MARGIN, offset) : MARGIN;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (raw.edge === 'left') {
        return { right: Math.max(MARGIN, vw - w - MARGIN), bottom: Math.max(MARGIN, vh - h - off) };
      }
      if (raw.edge === 'right') {
        return { right: MARGIN, bottom: Math.max(MARGIN, vh - h - off) };
      }
      if (raw.edge === 'top') {
        return { right: Math.max(MARGIN, vw - w - off), bottom: Math.max(MARGIN, vh - h - MARGIN) };
      }
      if (raw.edge === 'bottom') {
        return { right: Math.max(MARGIN, vw - w - off), bottom: MARGIN };
      }
    }

    return { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM };
  }

  /**
   * Apply preferred right/bottom, clamping only for the current viewport.
   * Preferred insets are never overwritten by the clamp.
   * @param {HTMLElement} iconWrapper
   * @param {{ right: number, bottom: number }} pos
   */
  function applyPosition(iconWrapper, pos) {
    if (!iconWrapper || !pos) return;
    const { w, h } = measureSize(iconWrapper);
    const maxRight = Math.max(MARGIN, window.innerWidth - w - MARGIN);
    const maxBottom = Math.max(MARGIN, window.innerHeight - h - MARGIN);
    const right = clamp(pos.right, MARGIN, maxRight);
    const bottom = clamp(pos.bottom, MARGIN, maxBottom);

    preferred = {
      right: Math.max(MARGIN, Number(pos.right) || MARGIN),
      bottom: Math.max(MARGIN, Number(pos.bottom) || MARGIN),
    };

    iconWrapper.classList.add('anchored');
    iconWrapper.classList.remove('dragging');
    iconWrapper.style.left = 'auto';
    iconWrapper.style.top = 'auto';
    iconWrapper.style.right = `${right}px`;
    iconWrapper.style.bottom = `${bottom}px`;
    iconWrapper.style.removeProperty('--neura-icon-left');
    iconWrapper.style.removeProperty('--neura-icon-top');
    iconWrapper.style.removeProperty('--neura-icon-right');
    iconWrapper.style.removeProperty('--neura-icon-bottom');
  }

  /** @param {{ right: number, bottom: number }} pos */
  function persistPosition(pos) {
    preferred = {
      right: Math.max(MARGIN, Number(pos.right) || MARGIN),
      bottom: Math.max(MARGIN, Number(pos.bottom) || MARGIN),
    };
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: preferred });
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * @param {number} left
   * @param {number} top
   * @param {number} w
   * @param {number} h
   */
  function insetsFromTopLeft(left, top, w, h) {
    return {
      right: Math.max(MARGIN, window.innerWidth - left - w),
      bottom: Math.max(MARGIN, window.innerHeight - top - h),
    };
  }

  /** @param {HTMLElement} iconWrapper */
  function applyStoredPosition(iconWrapper) {
    boundWrapper = iconWrapper;
    applyPosition(iconWrapper, preferred);
    try {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        if (!boundWrapper) return;
        const pos = normalizePos(res && res[STORAGE_KEY]);
        preferred = pos;
        applyPosition(boundWrapper, preferred);
      });
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * Free drag uses left/top for the pointer follow; resting state never does.
   * @param {HTMLElement} iconWrapper
   * @param {number} clientX
   * @param {number} clientY
   */
  function updateFreePosition(iconWrapper, clientX, clientY) {
    const { w, h } = measureSize(iconWrapper);
    const left = clamp(clientX - w / 2, MARGIN, window.innerWidth - w - MARGIN);
    const top = clamp(clientY - h / 2, MARGIN, window.innerHeight - h - MARGIN);
    iconWrapper.classList.add('anchored');
    iconWrapper.style.right = 'auto';
    iconWrapper.style.bottom = 'auto';
    iconWrapper.style.left = `${left}px`;
    iconWrapper.style.top = `${top}px`;
  }

  function reapplyOnViewportChange() {
    if (!boundWrapper) return;
    applyPosition(boundWrapper, preferred);
  }

  function onViewportChange() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      reapplyOnViewportChange();
    }, 50);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportChange);
      window.visualViewport.addEventListener('scroll', onViewportChange);
    }
  }

  /** @param {HTMLElement} handle */
  function prepareHandle(handle) {
    if (!handle) return;
    handle.draggable = false;
    handle.style.touchAction = 'none';
  }

  /**
   * @param {HTMLElement} iconWrapper
   * @param {HTMLElement} handle
   * @param {{ onClick?: (e: PointerEvent) => void }} [opts]
   */
  function makeDraggable(iconWrapper, handle, opts = {}) {
    if (!iconWrapper || !handle) return;
    boundWrapper = iconWrapper;
    prepareHandle(handle);

    let active = false;
    let dragMode = false;
    let repositioned = false;
    let longPressArmed = false;
    let startX = 0;
    let startY = 0;
    let downAt = 0;
    let suppressClick = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let longPressTimer = null;

    const clearLongPressTimer = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const enterDragMode = () => {
      if (dragMode) return;
      dragMode = true;
      iconWrapper.classList.add('dragging');
    };

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;

      active = true;
      dragMode = false;
      repositioned = false;
      longPressArmed = false;
      startX = e.clientX;
      startY = e.clientY;
      downAt = Date.now();

      clearLongPressTimer();
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (!active) return;
        longPressArmed = true;
        enterDragMode();
      }, LONG_PRESS_MS);

      try {
        handle.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    });

    handle.addEventListener('pointermove', (e) => {
      if (!active) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!dragMode && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        clearLongPressTimer();
        enterDragMode();
      }

      if (!dragMode) return;

      e.preventDefault();
      repositioned = true;
      updateFreePosition(iconWrapper, e.clientX, e.clientY);
    });

    function endPointer(e) {
      if (!active) return;

      active = false;
      clearLongPressTimer();
      iconWrapper.classList.remove('dragging');

      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const movedLittle = Math.hypot(dx, dy) <= TAP_MAX_MOVE;
      const wasDragSession = dragMode || longPressArmed;

      if (wasDragSession && repositioned) {
        const { w, h } = measureSize(iconWrapper);
        const left = clamp(e.clientX - w / 2, MARGIN, window.innerWidth - w - MARGIN);
        const top = clamp(e.clientY - h / 2, MARGIN, window.innerHeight - h - MARGIN);
        const pos = insetsFromTopLeft(left, top, w, h);
        preferred = pos;
        applyPosition(iconWrapper, pos);
        persistPosition(pos);
      } else if (wasDragSession) {
        // Long-press without move: restore anchored right/bottom.
        applyPosition(iconWrapper, preferred);
      }

      dragMode = false;
      longPressArmed = false;

      if (wasDragSession) {
        suppressClick = true;
        return;
      }

      const elapsed = Date.now() - downAt;
      if (elapsed < LONG_PRESS_MS && movedLittle && typeof opts.onClick === 'function') {
        opts.onClick(e);
        suppressClick = true;
      }
    }

    handle.addEventListener('pointerup', endPointer);
    handle.addEventListener('pointercancel', endPointer);

    handle.addEventListener('dragstart', (e) => e.preventDefault());
    handle.addEventListener(
      'click',
      (e) => {
        if (!suppressClick) return;
        suppressClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
  }

  Neura.iconDrag = { makeDraggable, applyStoredPosition, prepareHandle };
})(window.Neura);
