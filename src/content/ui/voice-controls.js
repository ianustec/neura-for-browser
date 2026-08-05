(function (Neura) {
  Neura.ui = Neura.ui || {};

  function micIconSvg() {
    return `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="11" rx="3"/>
        <path d="M5 10v1a7 7 0 0 0 14 0v-1"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
      </svg>`;
  }

  function voiceModeIconSvg() {
    return `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 11v2"/>
        <path d="M7.5 7v10"/>
        <path d="M12 4v16"/>
        <path d="M16.5 7v10"/>
        <path d="M21 11v2"/>
      </svg>`;
  }

  /**
   * Mount Dictate and Voice mode as icon buttons immediately left of Send.
   * @param {HTMLElement} actionsContainer  #composer-actions wrapper
   */
  function mountComposerButtons(actionsContainer) {
    if (!actionsContainer || actionsContainer.querySelector('#dictate-toggle-btn')) return;

    const dictateBtn = document.createElement('button');
    dictateBtn.id = 'dictate-toggle-btn';
    dictateBtn.className = 'composer-icon-btn voice-action-btn';
    dictateBtn.type = 'button';
    dictateBtn.dataset.active = 'false';
    dictateBtn.setAttribute('aria-pressed', 'false');
    dictateBtn.setAttribute('aria-label', Neura.i18n.t('toggleDictate'));
    dictateBtn.innerHTML = micIconSvg();
    dictateBtn.title = Neura.i18n.t('dictateTitle');
    dictateBtn.addEventListener('click', () => {
      if (Neura.voiceSession) Neura.voiceSession.toggleDictate();
    });

    const voiceModeBtn = document.createElement('button');
    voiceModeBtn.id = 'voice-mode-btn';
    voiceModeBtn.className = 'composer-icon-btn voice-action-btn';
    voiceModeBtn.type = 'button';
    voiceModeBtn.setAttribute('aria-label', Neura.i18n.t('voiceModeTitle'));
    voiceModeBtn.innerHTML = voiceModeIconSvg();
    voiceModeBtn.title = Neura.i18n.t('voiceModeButtonTitle');
    voiceModeBtn.addEventListener('click', () => {
      if (Neura.voiceMode) Neura.voiceMode.open();
    });

    // Insert before send button if present, otherwise append.
    const sendButton = actionsContainer.querySelector('#send-button');
    if (sendButton) {
      actionsContainer.insertBefore(dictateBtn, sendButton);
      actionsContainer.insertBefore(voiceModeBtn, sendButton);
    } else {
      actionsContainer.appendChild(dictateBtn);
      actionsContainer.appendChild(voiceModeBtn);
    }
  }

  Neura.voiceControls = {
    mountComposerButtons,
  };
})(window.Neura);
