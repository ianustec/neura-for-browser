(function (Neura) {
  /** @type {{ parent: Element, nextSibling: Node|null }|null} */
  let saved = null;
  let adopted = false;

  function getMessageArea() {
    return Neura.shadow?.$('message-area');
  }

  /**
   * Move the live #message-area into the voice overlay chat slot.
   * @param {HTMLElement} slotEl
   * @returns {boolean}
   */
  function adopt(slotEl) {
    const area = getMessageArea();
    if (!area || !slotEl || adopted) return false;

    saved = {
      parent: area.parentNode,
      nextSibling: area.nextSibling,
    };
    area.classList.add('neura-voice-message-area');
    slotEl.appendChild(area);
    adopted = true;
    scrollToBottom(true);
    return true;
  }

  /** Restore #message-area to its original place in #chat-main. */
  function restore() {
    const area = getMessageArea();
    if (!area) {
      adopted = false;
      saved = null;
      return;
    }

    if (saved && saved.parent) {
      area.classList.remove('neura-voice-message-area');
      if (saved.nextSibling && saved.nextSibling.parentNode === saved.parent) {
        saved.parent.insertBefore(area, saved.nextSibling);
      } else {
        saved.parent.appendChild(area);
      }
    }

    adopted = false;
    saved = null;
  }

  /**
   * @param {boolean} [force]
   */
  function scrollToBottom(force) {
    const area = getMessageArea();
    if (!area || !adopted) return;
    if (force || Neura.state?.autoScrollEnabled) {
      requestAnimationFrame(() => {
        area.scrollTop = area.scrollHeight;
      });
    }
  }

  function isAdopted() {
    return adopted;
  }

  Neura.voiceChatSlot = {
    adopt,
    restore,
    scrollToBottom,
    isAdopted,
  };
})(window.Neura);
