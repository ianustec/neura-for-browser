(function (Neura) {
  function autoResizeTextarea(element) {
    const textarea = element || this;
    if (!textarea || !textarea.style || typeof textarea.style.height === 'undefined') return;

    const MAX_ROWS = 4;
    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = parseInt(computedStyle.lineHeight, 10);
    const paddingTop = parseInt(computedStyle.paddingTop, 10);
    const paddingBottom = parseInt(computedStyle.paddingBottom, 10);
    const borderTop = parseInt(computedStyle.borderTopWidth, 10);
    const borderBottom = parseInt(computedStyle.borderBottomWidth, 10);

    const SINGLE_ROW_HEIGHT = lineHeight + paddingTop + paddingBottom + borderTop + borderBottom - 2;

    textarea.style.height = 'auto';
    const rows = Math.floor(textarea.scrollHeight / SINGLE_ROW_HEIGHT);

    if (rows <= MAX_ROWS) {
      textarea.style.height = `${Math.max(rows * SINGLE_ROW_HEIGHT, SINGLE_ROW_HEIGHT)}px`;
      textarea.style.overflowY = 'hidden';
    } else {
      textarea.style.height = `${MAX_ROWS * SINGLE_ROW_HEIGHT}px`;
      textarea.style.overflowY = 'auto';
      textarea.style.paddingTop = '10px';
      textarea.style.paddingBottom = '10px';
    }
    Neura.messages.updateMessageAreaHeight();
  }

  Neura.input = { autoResizeTextarea };
})(window.Neura);
