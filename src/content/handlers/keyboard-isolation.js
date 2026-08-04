(function (Neura) {
  const HOST_ID = 'gptew-chat-container';

  const ISOLATED_EVENTS = [
    'keydown',
    'keyup',
    'keypress',
    'beforeinput',
    'input',
    'paste',
    'copy',
    'cut',
    'compositionstart',
    'compositionupdate',
    'compositionend',
  ];

  function isInsideOurShadow(event) {
    const path = event.composedPath();
    return path.some((node) => node && node.id === HOST_ID);
  }

  Neura.keyboard = {
    install() {
      for (const type of ISOLATED_EVENTS) {
        window.addEventListener(
          type,
          (ev) => {
            if (!isInsideOurShadow(ev)) return;
            ev.stopImmediatePropagation();

            const target = ev.composedPath()[0];
            const isMessageInput = target && target.id === 'message-input';
            const isSidebarSearch = target && target.id === 'chat-sidebar-search';

            // Same rationale as message-input below: stopImmediatePropagation()
            // above means this field's own "input"/"keydown" listeners (if any
            // were attached directly on it) never run, so its reactions to
            // typing/Enter must be driven from here instead.
            if (isSidebarSearch && ev.type === 'input') {
              if (Neura.chatSidebar && typeof Neura.chatSidebar.handleSearchTyping === 'function') {
                Neura.chatSidebar.handleSearchTyping(target.value);
              }
            }

            if (isSidebarSearch && ev.type === 'keydown' && ev.key === 'Enter') {
              ev.preventDefault();
              if (Neura.chatSidebar && typeof Neura.chatSidebar.submitSearch === 'function') {
                Neura.chatSidebar.submitSearch(target.value);
              }
            }

            // stopImmediatePropagation() above halts the whole remaining
            // dispatch (capturing into the shadow tree, "at target", and
            // bubbling), so listeners registered directly on elements
            // inside our shadow DOM for these event types never run. The
            // message-input's own reactions to typing are therefore driven
            // from here instead.
            if (isMessageInput && ev.type === 'input') {
              if (Neura.input && typeof Neura.input.autoResizeTextarea === 'function') {
                Neura.input.autoResizeTextarea(target);
              }
              const panelMode = Neura.state?.panelMode || 'chat';
              if (panelMode === 'chat') {
                if (Neura.modelMention && typeof Neura.modelMention.handleInput === 'function') {
                  Neura.modelMention.handleInput();
                }
                if (Neura.knowledgeMention && typeof Neura.knowledgeMention.handleInput === 'function') {
                  Neura.knowledgeMention.handleInput();
                }
              }
              if (panelMode !== 'note') {
                if (Neura.promptMention && typeof Neura.promptMention.handleInput === 'function') {
                  Neura.promptMention.handleInput();
                }
              }
            }

            if (isMessageInput && ev.type === 'keydown') {
              const panelMode = Neura.state?.panelMode || 'chat';
              if (panelMode === 'chat' && Neura.modelMention && Neura.modelMention.isOpen()) {
                if (Neura.modelMention.handleKeydown(ev)) {
                  ev.preventDefault();
                  return;
                }
              }
              if (panelMode === 'chat' && Neura.knowledgeMention && Neura.knowledgeMention.isOpen()) {
                if (Neura.knowledgeMention.handleKeydown(ev)) {
                  ev.preventDefault();
                  return;
                }
              }
              if (panelMode !== 'note' && Neura.promptMention && Neura.promptMention.isOpen()) {
                if (Neura.promptMention.handleKeydown(ev)) {
                  ev.preventDefault();
                  return;
                }
              }
              if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                if (Neura.streaming && typeof Neura.streaming.sendUserMessage === 'function') {
                  Neura.streaming.sendUserMessage();
                }
              }
            }

            // Paste on message-input: listeners on the textarea never run because
            // stopImmediatePropagation() above halts dispatch into the shadow tree.
            if (isMessageInput && ev.type === 'paste') {
              const text = ev.clipboardData?.getData('text/plain')?.trim() || '';
              const isImg = !!(Neura.fileAttachments?.isDirectImageUrl && Neura.fileAttachments.isDirectImageUrl(text));
              if (isImg && Neura.fileAttachments?.tryAttachPastedImageUrl) {
                ev.preventDefault();
                Neura.fileAttachments.tryAttachPastedImageUrl(text, target).catch((err) => {
                  console.warn('[Neura] pasted image URL attach failed', err);
                });
              }
            }
          },
          { capture: true },
        );
      }
    },
  };
})(window.Neura);
