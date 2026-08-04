(function (Neura) {
  /** @type {HTMLElement|null} */
  let overlay = null;
  /** @type {((ev: KeyboardEvent) => void)|null} */
  let keydownListener = null;
  let handlers = {};
  /** @type {Promise<void>|null} */
  let mountPromise = null;
  let chatExpanded = false;

  function micIcon() {
    return `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="11" rx="3"/>
        <path d="M5 10v1a7 7 0 0 0 14 0v-1"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
      </svg>`;
  }

  function micOffIcon() {
    return `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="3" y1="3" x2="21" y2="21"/>
        <path d="M9 9v3a3 3 0 0 0 5 2.2"/>
        <path d="M15 11V5a3 3 0 0 0-5.6-1.5"/>
        <path d="M5 10v1a7 7 0 0 0 10.7 6"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
      </svg>`;
  }

  function hangUpIcon() {
    return `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2.5 15.5c5.2-4.7 13.8-4.7 19 0l.5-2.6c-6-5.6-14-5.6-20 0z"/>
        <line x1="4" y1="20" x2="20" y2="4"/>
      </svg>`;
  }

  function statusLabel(state) {
    switch (state) {
      case 'listening':
        return Neura.i18n.t('voiceModeListening');
      case 'transcribing':
        return Neura.i18n.t('voiceModeTranscribing');
      case 'thinking':
        return Neura.i18n.t('voiceModeThinking');
      case 'speaking':
        return Neura.i18n.t('voiceModeSpeaking');
      case 'muted':
        return Neura.i18n.t('voiceModeMuted');
      default:
        return Neura.i18n.t('voiceModeConnecting');
    }
  }

  function query(selector) {
    return overlay ? overlay.querySelector(selector) : null;
  }

  /**
   * Map voice-call UI state onto the SVG animation player.
   * @param {string} state
   */
  function syncAnimation(state) {
    const player = Neura.animationPlayer;
    if (!player?.isMounted?.()) return;

    switch (state) {
      case 'speaking':
      case 'listening':
        // Mic / TTS levels arrive via setAudioLevel → live envelope.
        player.setMode('live');
        break;
      case 'thinking':
      case 'transcribing':
        player.setMode('speak');
        break;
      case 'muted':
        player.setMode('idle');
        player.setExternalAmp(0);
        break;
      case 'connecting':
      default:
        player.setMode('idle');
        break;
    }
  }

  function setState(state) {
    if (!overlay) return;
    overlay.dataset.state = state;
    const status = query('.neura-voice-status');
    if (status) status.textContent = statusLabel(state);

    const canTap =
      state === 'speaking' || state === 'thinking' || state === 'listening';
    const hint = query('.neura-voice-hint');
    if (hint) {
      if (state === 'listening') {
        hint.textContent = Neura.i18n.t('voiceModeSendHint');
      } else if (state === 'speaking' || state === 'thinking') {
        hint.textContent = Neura.i18n.t('voiceModeInterruptHint');
      } else {
        hint.textContent = '';
      }
    }
    const tap = query('.neura-voice-tap');
    if (tap) tap.disabled = !canTap;

    syncAnimation(state);
  }

  function setMuted(muted) {
    const btn = query('.neura-voice-mute');
    if (!btn) return;
    btn.classList.toggle('is-muted', !!muted);
    btn.innerHTML = muted ? micOffIcon() : micIcon();
    const label = muted ? Neura.i18n.t('voiceModeUnmute') : Neura.i18n.t('voiceModeMute');
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  function setAudioLevel(level) {
    Neura.animationPlayer?.setExternalAmp?.(level);
  }

  function useSyntheticSpeech() {
    Neura.animationPlayer?.setMode?.('speak');
  }

  function expandChat() {
    if (!overlay || chatExpanded) return;
    chatExpanded = true;
    overlay.dataset.layout = 'chat';
    const slot = query('.neura-voice-chat-slot');
    if (slot) Neura.voiceChatSlot?.adopt?.(slot);
  }

  function collapseChat() {
    if (!overlay) return;
    chatExpanded = false;
    overlay.dataset.layout = 'hero';
    Neura.voiceChatSlot?.restore?.();
  }

  /**
   * @param {{ onHangUp: Function, onToggleMute: Function, onInterrupt: Function }} opts
   */
  function open(opts) {
    handlers = opts || {};
    const chatWindow = Neura.shadow?.root?.()?.getElementById('chat-window');
    if (!chatWindow) return;
    close();

    chatExpanded = false;

    overlay = document.createElement('div');
    overlay.className = 'neura-voice-overlay';
    overlay.dataset.state = 'connecting';
    overlay.dataset.layout = 'hero';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', Neura.i18n.t('voiceModeTitle'));
    overlay.innerHTML = `
      <div class="neura-voice-backdrop">
        <div class="neura-voice-art-host" id="neura-voice-art-host"></div>
      </div>
      <div class="neura-voice-stage">
        <div class="neura-voice-title">${Neura.i18n.t('voiceModeTitle')}</div>
        <div class="neura-voice-mark-zone">
          <button type="button" class="neura-voice-tap"></button>
        </div>
        <div class="neura-voice-chat-slot" aria-label="Voice conversation"></div>
        <div class="neura-voice-panel">
          <div class="neura-voice-status"></div>
          <div class="neura-voice-hint"></div>
          <div class="neura-voice-actions">
            <button type="button" class="neura-voice-btn neura-voice-mute"></button>
            <button type="button" class="neura-voice-btn neura-voice-hangup">${hangUpIcon()}</button>
          </div>
        </div>
      </div>`;

    const hangUp = query('.neura-voice-hangup');
    hangUp.setAttribute('aria-label', Neura.i18n.t('voiceModeHangUp'));
    hangUp.title = Neura.i18n.t('voiceModeHangUp');
    hangUp.addEventListener('click', () => handlers.onHangUp?.());

    const tap = query('.neura-voice-tap');
    tap.setAttribute('aria-label', Neura.i18n.t('voiceModeInterrupt'));
    tap.addEventListener('click', () => handlers.onInterrupt?.());

    query('.neura-voice-mute').addEventListener('click', () => handlers.onToggleMute?.());

    setMuted(false);
    setState('connecting');

    keydownListener = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      handlers.onHangUp?.();
    };
    document.addEventListener('keydown', keydownListener, true);

    chatWindow.appendChild(overlay);

    const artHost = query('.neura-voice-art-host');
    if (artHost && Neura.animationPlayer) {
      mountPromise = Neura.animationPlayer
        .mount(artHost, { mode: 'idle' })
        .then(() => {
          if (overlay) syncAnimation(overlay.dataset.state || 'connecting');
        })
        .catch(() => {});
    }
  }

  function close() {
    if (keydownListener) {
      document.removeEventListener('keydown', keydownListener, true);
      keydownListener = null;
    }
    mountPromise = null;
    Neura.voiceChatSlot?.restore?.();
    chatExpanded = false;
    Neura.animationPlayer?.unmount?.();
    overlay?.remove();
    overlay = null;
  }

  Neura.voiceOverlay = {
    open,
    close,
    setState,
    setMuted,
    setAudioLevel,
    useSyntheticSpeech,
    expandChat,
    collapseChat,
    isChatExpanded() {
      return chatExpanded;
    },
    isOpen() {
      return !!overlay;
    },
    // Legacy no-ops — conversation lives in #message-area.
    setTranscript() {},
    setReply() {},
  };
})(window.Neura);
