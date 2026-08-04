(function (Neura) {
  let attempted = false;
  let active = false;
  /** @type {Promise<boolean>|null} */
  let rejoinInFlight = null;

  function removeOrphanAssistantBubbles() {
    const messageArea = Neura.shadow.$('message-area');
    if (!messageArea) return 0;
    let removed = 0;
    messageArea.querySelectorAll('.message-container').forEach((container) => {
      if (!container.querySelector('.assistant-message')) return;
      const activeThought = container.querySelector('.neura-thought-block.is-active');
      const contentEl = container.querySelector('.message-content');
      const text = (contentEl && contentEl.textContent) || '';
      // Stale rejoin bubble: still "thinking" and no answer body yet.
      if (activeThought && !text.trim()) {
        container.remove();
        removed += 1;
      }
    });
    return removed;
  }

  function rejoinFromSnapshot(port, snapshot) {
    if (!snapshot) return;
    const activeChatId = Neura.session.getActiveChatId();
    if (snapshot.chatId && activeChatId && snapshot.chatId !== activeChatId) {
      try { port.disconnect(); } catch (e) {}
      return;
    }
    const messageArea = Neura.shadow.$('message-area');
    if (!messageArea) return;

    // Drop empty "Sto pensando…" bubbles from a raced previous rejoin.
    removeOrphanAssistantBubbles();

    const initial = snapshot.finalText
      ? snapshot.finalText + (snapshot.partialContent || '')
      : (snapshot.partialContent || '');

    const ctx = Neura.streaming.buildAssistantBubble(initial);
    if (!ctx) return;

    const s = Neura.state;
    const turnStillRunning =
      snapshot.phase !== 'done' &&
      snapshot.phase !== 'aborted' &&
      snapshot.phase !== 'error';
    s.agentRunning = !!snapshot.agentMode && turnStillRunning;
    if (snapshot.agentMode && turnStillRunning) {
      Neura.agentLog.attachTo(ctx.contentWrapper, port, snapshot.agentLog || []);
      s.agentMode = true;
      const agentToggle = Neura.shadow?.$('agent-toggle-btn');
      if (agentToggle) {
        agentToggle.dataset.active = 'true';
        agentToggle.classList.add('active');
      }
    }

    if (snapshot.lastStatus && !snapshot.lastStatus.hidden) {
      Neura.messages.upsertStatusChip(ctx.contentWrapper, {
        description: snapshot.lastStatus.description || '',
        done: false,
        hidden: false,
      });
    }

    if (snapshot.phase === 'navigating') {
      Neura.messages.upsertStatusChip(ctx.contentWrapper, {
        description: Neura.i18n.t('navigating'),
        done: false,
        hidden: false,
      });
    }

    Neura.streaming.installPortListener(port, {
      ...ctx,
      turnId: snapshot.turnId || null,
      chatId: snapshot.chatId || activeChatId || null,
      agentMode: !!snapshot.agentMode && turnStillRunning,
      initialContent: initial,
    });

    if (snapshot.partialReasoning) {
      Neura.messages.removeThoughtBlock(ctx.contentWrapper);
      Neura.messages.appendThoughtContent(ctx.contentWrapper, snapshot.partialReasoning);
    }

    // If the turn already finished (late rejoin), collapse thinking immediately.
    if (snapshot.phase === 'done' || snapshot.finalText) {
      if (Neura.messages.finalizeAllThoughtBlocks) {
        Neura.messages.finalizeAllThoughtBlocks(ctx.contentWrapper, { collapse: true });
      } else {
        Neura.messages.finalizeThoughtBlock(ctx.contentWrapper, { collapse: true });
      }
      Neura.messages.toggleSendIcon('send');
    } else {
      Neura.messages.toggleSendIcon('loading');
    }
    active = true;
  }

  function tryRejoin() {
    if (active) return Promise.resolve(true);
    if (rejoinInFlight) return rejoinInFlight;
    if (window !== window.top) return Promise.resolve(false);

    rejoinInFlight = new Promise((resolve) => {
      let port;
      try {
        port = chrome.runtime.connect({ name: 'streaming' });
      } catch (e) {
        rejoinInFlight = null;
        resolve(false);
        return;
      }

      let resolved = false;
      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          rejoinInFlight = null;
          resolve(active);
        }
      };

      port.onMessage.addListener((msg) => {
        if (msg.type === 'no_active_turn') {
          try { port.disconnect(); } catch (e) {}
          cleanup();
          return;
        }
        if (msg.type === 'rejoin_state') {
          // Another concurrent caller may have won already.
          if (active) {
            try { port.disconnect(); } catch (e) {}
            cleanup();
            return;
          }
          rejoinFromSnapshot(port, msg.snapshot);
          cleanup();
          return;
        }
      });

      port.onDisconnect.addListener(cleanup);

      try {
        port.postMessage({ action: 'rejoinTurn' });
      } catch (e) {
        cleanup();
      }

      setTimeout(cleanup, 5000);
    });

    return rejoinInFlight;
  }

  async function tryRehydrateDraft() {
    // Always attempt rejoin first: after cross-origin navigate the domain-keyed
    // draft is missing, but the SW turn is still alive and must be attached.
    const rejoined = await tryRejoin();
    if (rejoined) return true;

    const draft = await Neura.session.getAssistantDraft();
    if (!draft || !draft.partial) return false;

    const messageArea = Neura.shadow.$('message-area');
    if (!messageArea) return false;
    const finalContent = `${draft.partial}\n\n---\n\n${Neura.i18n.t('responseInterrupted')}`;
    Neura.messages.addMessageToChat('assistant', finalContent);
    Neura.session.clearAssistantDraft();
    return true;
  }

  function queryActiveTurn() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'getActiveTurn' }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ active: false });
            return;
          }
          resolve(res || { active: false });
        });
      } catch (e) {
        resolve({ active: false });
      }
    });
  }

  Neura.turnRejoin = {
    tryRejoin,
    tryRehydrateDraft,
    queryActiveTurn,
    removeOrphanAssistantBubbles,
    markAttempted() { attempted = true; },
    isActive() { return active; },
  };
})(window.Neura);
