(function (Neura) {
  Neura.agentLog = {
    beginSession(wrapper, port) {
      if (!wrapper || !port) return;
      Neura.agentLog.endSession();
      const panel = document.createElement('div');
      panel.className = 'neura-agent-panel';

      const header = document.createElement('div');
      header.className = 'neura-agent-panel-header';

      const stopBtn = document.createElement('button');
      stopBtn.type = 'button';
      stopBtn.className = 'neura-agent-stop';
      stopBtn.textContent = Neura.i18n.t('stopAgent');
      stopBtn.title = Neura.i18n.t('stopAgentTitle');
      stopBtn.addEventListener('click', () => {
        port.postMessage({ action: 'abortAgent' });
      });
      header.appendChild(stopBtn);

      const status = document.createElement('div');
      status.className = 'neura-agent-status';
      status.textContent = Neura.i18n.t('agentRunning');
      header.appendChild(status);

      const chips = document.createElement('div');
      chips.className = 'neura-agent-chips';

      panel.appendChild(header);
      panel.appendChild(chips);

      const contentEl = wrapper.querySelector('.message-content');
      if (contentEl) {
        wrapper.insertBefore(panel, contentEl);
      } else {
        wrapper.insertBefore(panel, wrapper.firstChild);
      }

      Neura.state.agentLogPanel = panel;
      Neura.state.agentLogChips = chips;
      Neura.state.agentLogStatus = status;
      Neura.state.agentLogPort = port;
      Neura.state.agentChipStack = [];
    },

    attachTo(wrapper, port, existingEvents) {
      Neura.agentLog.beginSession(wrapper, port);
      if (!existingEvents || !existingEvents.length) return;
      let lastIter = 0;
      for (const ev of existingEvents) {
        if (ev.type === 'agent:iteration' && typeof ev.iteration === 'number') {
          lastIter = ev.iteration;
        } else if (ev.type === 'agent:call_start') {
          Neura.agentLog.onCallStart(ev.name || 'tool');
        } else if (ev.type === 'agent:call_end') {
          Neura.agentLog.onCallEnd(ev.name || 'tool');
        }
      }
      if (lastIter) Neura.agentLog.setIteration(lastIter);
    },

    endSession() {
      if (Neura.state.agentLogPanel?.parentNode) {
        Neura.state.agentLogPanel.parentNode.removeChild(Neura.state.agentLogPanel);
      }
      Neura.state.agentLogPanel = null;
      Neura.state.agentLogChips = null;
      Neura.state.agentLogStatus = null;
      Neura.state.agentLogPort = null;
      Neura.state.agentChipStack = [];
    },

    setIteration(n) {
      if (Neura.state.agentLogStatus) {
        Neura.state.agentLogStatus.textContent = Neura.i18n.t('agentStep', n);
      }
    },

    onCallStart(name) {
      const chips = Neura.state.agentLogChips;
      if (!chips) return;
      const chip = document.createElement('div');
      chip.className = 'neura-agent-chip running';
      chip.textContent = name;
      chip.title = name;
      chips.appendChild(chip);
      Neura.state.agentChipStack = Neura.state.agentChipStack || [];
      Neura.state.agentChipStack.push({ name, chip });
    },

    onCallEnd(name) {
      const stack = Neura.state.agentChipStack || [];
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          const { chip } = stack.splice(i, 1)[0];
          chip.classList.remove('running');
          chip.classList.add('done');
          break;
        }
      }
    },

    /**
     * Action label + icon key per tool, shown as the confirm card's title row.
     * @param {string} tool
     * @returns {{ label: string, icon: string }}
     */
    _confirmActionMeta(tool) {
      switch (tool) {
        case 'navigate':
          return { label: Neura.i18n.t('confirmNavigate'), icon: 'navigate' };
        case 'open_new_tab':
          return { label: Neura.i18n.t('confirmOpenTab'), icon: 'open_tab' };
        case 'download_file':
          return { label: Neura.i18n.t('confirmDownload'), icon: 'download' };
        default:
          return { label: tool || Neura.i18n.t('allowActionPrompt'), icon: 'generic' };
      }
    },

    /**
     * Renders an inline confirmation card inside the current agent panel
     * (same container as the tool chips), instead of a full-screen modal.
     * Falls back to auto-deny if no agent panel is mounted (e.g. session
     * already ended) so a pending confirm never hangs silently.
     * @param {{ confirmId: string, tool: string, args?: object, summary?: string }} payload
     * @param {(approved: boolean) => void} respond - kept for API compat; uses port from state
     */
    showConfirmModal(payload, respond) {
      const panel = Neura.state.agentLogPanel;
      if (!panel) {
        if (typeof respond === 'function') respond(false);
        return;
      }

      const meta = this._confirmActionMeta(payload.tool);
      const url = payload.args?.url || '';

      const card = document.createElement('div');
      card.className = 'neura-agent-confirm-card';

      const row = document.createElement('div');
      row.className = 'neura-agent-confirm-row';

      const icon = document.createElement('span');
      icon.className = `neura-agent-confirm-icon neura-agent-confirm-icon--${meta.icon}`;
      row.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'neura-agent-confirm-label';
      label.textContent = meta.label;
      row.appendChild(label);

      card.appendChild(row);

      if (url) {
        const urlBadge = document.createElement('div');
        urlBadge.className = 'neura-agent-confirm-url';
        urlBadge.textContent = url;
        urlBadge.title = url;
        card.appendChild(urlBadge);
      } else if (payload.summary) {
        const summaryEl = document.createElement('div');
        summaryEl.className = 'neura-agent-confirm-url';
        summaryEl.textContent = payload.summary;
        summaryEl.title = payload.summary;
        card.appendChild(summaryEl);
      }

      const actions = document.createElement('div');
      actions.className = 'neura-agent-confirm-actions';
      const deny = document.createElement('button');
      deny.type = 'button';
      deny.textContent = Neura.i18n.t('deny');
      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'primary';
      allow.textContent = Neura.i18n.t('allow');
      actions.appendChild(deny);
      actions.appendChild(allow);
      card.appendChild(actions);

      panel.appendChild(card);
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      const finish = (approved) => {
        deny.disabled = true;
        allow.disabled = true;
        card.classList.add(approved ? 'is-approved' : 'is-denied');
        setTimeout(() => {
          if (card.parentNode) card.parentNode.removeChild(card);
        }, 220);
        const p = Neura.state.agentLogPort;
        if (p) {
          p.postMessage({
            action: 'agentConfirmResponse',
            confirmId: payload.confirmId,
            approved,
          });
        }
        if (typeof respond === 'function') respond(approved);
      };
      deny.addEventListener('click', () => finish(false));
      allow.addEventListener('click', () => finish(true));
    },
  };
})(window.Neura);
