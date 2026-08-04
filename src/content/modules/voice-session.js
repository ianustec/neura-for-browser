(function (Neura) {
  const TRAILING_SEND_COMMAND_RE =
    /(?:^|\s+)(?:(?:in\s+via|invia|invio|invia)(?:\s+(?:il|un))?)\s+messagg(?:io|i)[.!?,;:]*$/i;
  const EXACT_SEND_COMMAND_RE =
    /^(?:(?:in\s+via|invia|invio|invia)(?:\s+(?:il|un))?)\s+messagg(?:io|i)[.!?,;:]*$/i;
  const TRAILING_SEND_COMMAND_EN_RE =
    /(?:^|\s+)send(?:\s+(?:the|a))?\s+messag(?:e|es)[.!?,;:]*$/i;
  const EXACT_SEND_COMMAND_EN_RE =
    /^send(?:\s+(?:the|a))?\s+messag(?:e|es)[.!?,;:]*$/i;

  function normalizeDictatedText(text) {
    return String(text || '')
      .replace(/[\u2019\u2018]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripTrailingPunctuation(text) {
    return String(text || '').replace(/[.!?,;:]+$/g, '').trim();
  }

  function getSendCommandPatterns() {
    const locale = Neura.i18n?.getLocale?.() || 'it';
    if (locale === 'en') {
      return { exact: EXACT_SEND_COMMAND_EN_RE, trailing: TRAILING_SEND_COMMAND_EN_RE };
    }
    return { exact: EXACT_SEND_COMMAND_RE, trailing: TRAILING_SEND_COMMAND_RE };
  }

  /**
   * Parse dictate transcription for a trailing "invia messaggio" command.
   * Accepts STT variants such as "in via messaggio" at the end only.
   * @param {string} raw
   * @param {string} existingInput
   * @returns {{ body: string, shouldSend: boolean }}
   */
  function parseDictateCommand(raw, existingInput) {
    const existing = String(existingInput || '').trim();
    const text = normalizeDictatedText(raw);
    if (!text) {
      return { body: existing, shouldSend: false };
    }

    const { exact, trailing } = getSendCommandPatterns();
    const stripped = stripTrailingPunctuation(text);

    if (exact.test(stripped)) {
      return { body: existing, shouldSend: !!existing };
    }

    const match = text.match(trailing);
    if (match) {
      const body = stripTrailingPunctuation(text.slice(0, match.index));
      const merged = [existing, body].filter(Boolean).join(' ').trim();
      return { body: merged, shouldSend: !!merged };
    }

    const merged = [existing, text].filter(Boolean).join(' ').trim();
    return { body: merged, shouldSend: false };
  }

  function sendRuntime(message, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Background timeout')), timeoutMs);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response || {});
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  function showVoiceError(message) {
    if (Neura.messages?.showStreamErrorBanner) {
      Neura.messages.showStreamErrorBanner(message);
    } else {
      console.warn('[Neura voice]', message);
    }
  }

  function isMicPermissionError(res) {
    return (
      res?.permissionDenied ||
      /notallowed|permission|denied/i.test(String(res?.error || ''))
    );
  }

  async function getMicPermissionState() {
    try {
      const res = await sendRuntime({ action: 'voice:getMicPermissionState' }, 5000);
      return String(res?.state || 'unknown');
    } catch (_) {
      return 'unknown';
    }
  }

  async function ensureMicPermission() {
    const state = await getMicPermissionState();
    if (state === 'granted') return true;

    if (state === 'denied') {
      showVoiceError(Neura.i18n.t('voiceMicDeniedSettings'));
      return false;
    }

    if (state === 'unknown') {
      const stored = await new Promise((resolve) => {
        chrome.storage.local.get(['neuraMicGranted'], (data) => resolve(data || {}));
      });
      if (stored.neuraMicGranted) return true;
    }

    if (!Neura.micPermission?.requestMicPermission) {
      showVoiceError(Neura.i18n.t('voiceMicDenied'));
      return false;
    }

    const granted = await Neura.micPermission.requestMicPermission();
    if (!granted) {
      showVoiceError(Neura.i18n.t('voiceMicDenied'));
      return false;
    }
    return true;
  }

  /** @type {'idle'|'recording'|'transcribing'} */
  let dictateState = 'idle';
  let runtimeListenerInstalled = false;
  let silenceStopInFlight = false;

  function setDictateUi(active) {
    const btn = Neura.shadow?.$('dictate-toggle-btn');
    if (!btn) return;
    btn.dataset.active = active ? 'true' : 'false';
    btn.classList.toggle('active', active);
    btn.classList.toggle('recording', dictateState === 'recording');
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function syncStateFlags() {
    Neura.state.dictateActive = dictateState === 'recording' || dictateState === 'transcribing';
  }

  async function transcribeBase64(base64, mimeType) {
    const language = Neura.i18n?.getLocale?.() || 'it';
    const res = await sendRuntime(
      {
        action: 'audio:transcribe',
        base64,
        mimeType,
        language,
      },
      120000,
    );
    if (!res.ok) throw new Error(res.error || Neura.i18n.t('voiceSttFailed'));
    return String(res.text || '').trim();
  }

  function applyTextToInput(body) {
    const input = Neura.shadow?.$('message-input');
    if (!input) return;
    input.value = body;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (Neura.input?.autoResizeTextarea) Neura.input.autoResizeTextarea.call(input);
    try {
      input.focus();
    } catch (_) {}
  }

  async function startDictate() {
    if (dictateState !== 'idle') return;

    try {
      if (!(await ensureMicPermission())) return;

      dictateState = 'recording';
      syncStateFlags();
      setDictateUi(true);

      let res = await sendRuntime({ action: 'voice:startRecording' }, 15000);
      if (!res.ok && isMicPermissionError(res)) {
        if (await ensureMicPermission()) {
          res = await sendRuntime({ action: 'voice:startRecording' }, 15000);
        }
      }

      if (!res.ok) {
        dictateState = 'idle';
        syncStateFlags();
        setDictateUi(false);
        if (isMicPermissionError(res)) {
          showVoiceError(Neura.i18n.t('voiceMicDenied'));
        } else {
          showVoiceError(res.error || Neura.i18n.t('voiceMicFailed'));
        }
        return;
      }
    } catch (e) {
      dictateState = 'idle';
      syncStateFlags();
      setDictateUi(false);
      showVoiceError(String(e.message || e));
    }
  }

  async function stopDictate({ cancel = false, autoSend = false } = {}) {
    if (dictateState !== 'recording') {
      dictateState = 'idle';
      syncStateFlags();
      setDictateUi(false);
      silenceStopInFlight = false;
      return;
    }

    dictateState = 'transcribing';
    syncStateFlags();
    setDictateUi(true);

    try {
      if (cancel) {
        await sendRuntime({ action: 'voice:stopSession' }, 10000).catch(() => {});
        dictateState = 'idle';
        syncStateFlags();
        setDictateUi(false);
        silenceStopInFlight = false;
        return;
      }

      const rec = await sendRuntime({ action: 'voice:stopRecording' }, 30000);
      if (!rec.ok || !rec.base64) {
        dictateState = 'idle';
        syncStateFlags();
        setDictateUi(false);
        silenceStopInFlight = false;
        if (rec.error && rec.error !== 'Empty recording') {
          showVoiceError(rec.error || Neura.i18n.t('voiceSttFailed'));
        }
        return;
      }

      const text = await transcribeBase64(rec.base64, rec.mimeType);
      const input = Neura.shadow?.$('message-input');
      const existing = input ? input.value : '';
      const { body, shouldSend } = parseDictateCommand(text, existing);
      const doSend = !!(body && (shouldSend || autoSend));
      applyTextToInput(body);

      dictateState = 'idle';
      syncStateFlags();
      setDictateUi(false);
      silenceStopInFlight = false;

      if (doSend && Neura.streaming?.sendUserMessage) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await Neura.streaming.sendUserMessage();
      }
    } catch (e) {
      dictateState = 'idle';
      syncStateFlags();
      setDictateUi(false);
      silenceStopInFlight = false;
      showVoiceError(String(e.message || e) || Neura.i18n.t('voiceSttFailed'));
    }
  }

  function onVoiceBridgeMessage(message) {
    if (message?.source !== 'voice-bridge') return;
    if (message.action !== 'voice:silenceDetected') return;
    if (dictateState !== 'recording' || silenceStopInFlight) return;
    silenceStopInFlight = true;
    stopDictate({ autoSend: true });
  }

  async function toggleDictate() {
    if (Neura.state?.voiceModeActive) return;
    if (dictateState === 'recording') {
      await stopDictate({ cancel: false });
    } else if (dictateState === 'idle') {
      await startDictate();
    }
  }

  function onDocumentKeydown(ev) {
    if (ev.key !== 'Escape') return;
    if (dictateState === 'recording') {
      ev.preventDefault();
      stopDictate({ cancel: true });
    }
  }

  Neura.voiceSession = {
    parseDictateCommand,
    sendRuntime,
    ensureMicPermission,
    showVoiceError,
    toggleDictate,
    startDictate,
    stopDictate,
    isDictateActive() {
      return dictateState !== 'idle';
    },
    mount() {
      if (!runtimeListenerInstalled) {
        document.addEventListener('keydown', onDocumentKeydown, true);
        chrome.runtime.onMessage.addListener(onVoiceBridgeMessage);
        runtimeListenerInstalled = true;
      }
      setDictateUi(false);
      syncStateFlags();
    },
  };
})(window.Neura);
