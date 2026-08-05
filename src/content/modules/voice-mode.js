(function (Neura) {
  // Long answers are synthesized in pieces so playback starts after the first
  // sentence instead of after the whole reply has been generated as audio.
  const MAX_CHUNK_CHARS = 220;

  /** @type {'idle'|'listening'|'transcribing'|'thinking'|'speaking'|'muted'} */
  let state = 'idle';
  let active = false;
  let muted = false;
  let listenerInstalled = false;

  // Bumped whenever the current reply is superseded (interrupt, hang up, new
  // turn) so in-flight synthesis and playback resolve into a no-op.
  let turnToken = 0;

  /** @type {'server'|'local'} */
  let ttsMode = 'server';
  /** @type {string|null} */
  let serverVoice = null;
  let voicesProbed = false;

  /** @type {{ resolve: Function }|null} */
  let playbackWaiter = null;

  function rpc(message, timeoutMs) {
    return Neura.voiceSession.sendRuntime(message, timeoutMs);
  }

  function setState(next) {
    state = next;
    Neura.voiceOverlay?.setState(next);
  }

  function fail(message) {
    Neura.voiceSession.showVoiceError(message || Neura.i18n.t('voiceModeFailed'));
    close();
  }

  /* ---------------------------------------------------------------- speech */

  /**
   * Markdown renders poorly when spoken, so strip it down to plain prose.
   * @param {string} markdown
   * @returns {string}
   */
  function toSpeechText(markdown) {
    return String(markdown || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\|.*\|\s*$/gm, ' ')
      .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/(\*\*|__|~~|\*|_)/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\s+/g, ' ')
      .replace(/\.\s*(?=\.)/g, '')
      .trim();
  }

  /**
   * @param {string} text
   * @returns {string[]}
   */
  function splitForSpeech(text) {
    const sentences = String(text).match(/[^.!?…]+[.!?…]*\s*/g) || [text];
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && (current + sentence).length > MAX_CHUNK_CHARS) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.filter(Boolean);
  }

  async function probeVoices() {
    if (voicesProbed) return;
    voicesProbed = true;
    try {
      const res = await rpc({ action: 'audio:voices' }, 10000);
      const voices = (res && res.ok && res.voices) || [];
      if (voices.length) serverVoice = voices[0].id;
    } catch (_) {
      // Voice listing is optional: the server may still expose a default voice.
    }
  }

  /**
   * @param {string} chunk
   * @returns {Promise<{ base64: string, mimeType: string }|null>}
   */
  function synthesize(chunk) {
    if (ttsMode !== 'server') return null;
    return rpc(
      { action: 'audio:speech', text: chunk, voice: serverVoice || undefined },
      60000,
    )
      .then((res) => {
        if (!res || !res.ok || !res.base64) throw new Error(res?.error || 'TTS unavailable');
        return { base64: res.base64, mimeType: res.mimeType };
      })
      .catch(() => {
        // Instances without a server-side TTS engine (or with the browser
        // WebAPI engine) fall back to local synthesis for the rest of the call.
        ttsMode = 'local';
        return null;
      });
  }

  function resolvePlaybackWait() {
    const waiter = playbackWaiter;
    if (!waiter) return;
    playbackWaiter = null;
    waiter.resolve();
  }

  /**
   * Playback happens in the offscreen document so strict host-page CSP cannot
   * block the audio.
   * @param {{ base64: string, mimeType: string }} audio
   * @returns {Promise<void>}
   */
  function playAudio(audio) {
    return new Promise((resolve) => {
      playbackWaiter = { resolve };
      // Live amp samples from the offscreen analyser drive the SVG mark.
      Neura.animationPlayer?.setMode?.('live');
      rpc({ action: 'voice:playAudio', base64: audio.base64, mimeType: audio.mimeType }, 15000)
        .then((res) => {
          if (!res || !res.ok) resolvePlaybackWait();
        })
        .catch(() => resolvePlaybackWait());
    });
  }

  /**
   * @param {string} text
   * @returns {Promise<void>}
   */
  function speakLocally(text) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
        resolve();
        return;
      }
      // Local TTS has no analyser — drive a synthetic speak envelope instead.
      Neura.voiceOverlay?.useSyntheticSpeech?.();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = Neura.i18n?.getLocale?.() === 'en' ? 'en-US' : 'it-IT';
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      try {
        synth.speak(utterance);
      } catch (_) {
        resolve();
      }
    });
  }

  function stopPlayback() {
    try {
      window.speechSynthesis?.cancel();
    } catch (_) {}
    rpc({ action: 'voice:stopPlayback' }, 5000).catch(() => {});
    resolvePlaybackWait();
  }

  /**
   * @param {string} text
   * @param {number} token
   */
  async function speak(text, token) {
    const chunks = splitForSpeech(text);
    let pending = chunks.length ? synthesize(chunks[0]) : null;

    for (let i = 0; i < chunks.length; i += 1) {
      if (!active || token !== turnToken) return;
      const audio = pending ? await pending : null;
      if (!active || token !== turnToken) return;

      pending = i + 1 < chunks.length ? synthesize(chunks[i + 1]) : null;

      if (audio) await playAudio(audio);
      else await speakLocally(chunks[i]);
    }
  }

  /* ------------------------------------------------------------ conversation */

  function startBargeInWatch() {
    if (!active || muted) return;
    rpc({ action: 'voice:startBargeIn' }, 10000).catch(() => {});
  }

  function stopBargeInWatch() {
    rpc({ action: 'voice:stopBargeIn' }, 5000).catch(() => {});
  }

  async function startListening() {
    if (!active || muted) return;
    stopBargeInWatch();
    setState('listening');

    let res = await startRecording();
    if (!active) return;

    // A recorder left over from an aborted turn would otherwise end the call.
    if (!res.ok && /already recording/i.test(String(res.error || ''))) {
      await rpc({ action: 'voice:stopSession' }, 10000).catch(() => {});
      if (!active) return;
      res = await startRecording();
      if (!active) return;
    }

    if (!res.ok) fail(res.error);
  }

  function startRecording() {
    return rpc({ action: 'voice:startRecording' }, 15000).catch((err) => ({
      ok: false,
      error: String(err.message || err),
    }));
  }

  async function captureAndSend() {
    if (!active || state !== 'listening') return;
    setState('transcribing');

    let rec;
    try {
      rec = await rpc({ action: 'voice:stopRecording' }, 30000);
    } catch (_) {
      rec = { ok: false };
    }
    if (!active) return;
    if (!rec.ok || !rec.base64) {
      startListening();
      return;
    }

    let text = '';
    try {
      const res = await rpc(
        {
          action: 'audio:transcribe',
          base64: rec.base64,
          mimeType: rec.mimeType,
          language: Neura.i18n?.getLocale?.() || 'it',
        },
        120000,
      );
      if (!res.ok) throw new Error(res.error || Neura.i18n.t('voiceSttFailed'));
      text = String(res.text || '').trim();
    } catch (err) {
      if (!active) return;
      fail(String(err.message || err));
      return;
    }

    if (!active) return;
    if (!text) {
      startListening();
      return;
    }

    Neura.voiceOverlay?.expandChat?.();
    setState('thinking');
    sendToChat(text);
    // Keep mic open for barge-in: user speech aborts the LLM stream instantly.
    startBargeInWatch();
  }

  function sendToChat(text) {
    const input = Neura.shadow?.$('message-input');
    if (!input || !Neura.streaming?.sendUserMessage) {
      fail(Neura.i18n.t('voiceModeFailed'));
      return;
    }
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    Neura.streaming.sendUserMessage();
  }

  /**
   * Called by the streaming handler once a turn reaches a terminal state.
   * @param {string} finalText
   */
  async function onTurnFinished(finalText) {
    if (!active || state !== 'thinking') return;

    const speech = toSpeechText(finalText);
    if (!speech) {
      startListening();
      return;
    }

    const token = ++turnToken;
    setState('speaking');
    startBargeInWatch();
    await speak(speech, token);
    if (!active || token !== turnToken) return;
    startListening();
  }

  function interrupt() {
    if (!active) return;
    // While listening, tap means "I'm done speaking" → stop + OWUI STT.
    if (state === 'listening') {
      captureAndSend();
      return;
    }
    turnToken += 1;
    stopPlayback();
    stopBargeInWatch();
    if (state === 'speaking') {
      startListening();
    } else if (state === 'thinking' || state === 'transcribing') {
      Neura.streaming?.abortActiveStream?.();
      startListening();
    }
  }

  function toggleMute() {
    if (!active) return;
    muted = !muted;
    Neura.voiceOverlay?.setMuted(muted);
    if (muted) {
      stopBargeInWatch();
      rpc({ action: 'voice:stopSession' }, 5000).catch(() => {});
      setState('muted');
    } else if (state === 'muted') {
      startListening();
    }
  }

  function onBridgeMessage(message) {
    if (message?.source !== 'voice-bridge' || !active) return;
    if (message.action === 'voice:silenceDetected') {
      if (state === 'listening') captureAndSend();
    } else if (message.action === 'voice:bargeIn') {
      // User started talking over thinking / TTS → cut LLM + enter listening.
      if (state === 'thinking' || state === 'speaking') {
        interrupt();
      }
    } else if (message.action === 'voice:playbackEnded') {
      Neura.voiceOverlay?.setAudioLevel?.(0);
      resolvePlaybackWait();
    } else if (message.action === 'voice:audioLevel') {
      if (state === 'speaking' || state === 'listening') {
        Neura.voiceOverlay?.setAudioLevel?.(Number(message.level) || 0);
      }
    }
  }

  async function open() {
    if (active) return;
    if (Neura.voiceSession?.isDictateActive?.()) return;
    if (!(await Neura.voiceSession.ensureMicPermission())) return;

    active = true;
    muted = false;
    ttsMode = 'server';
    Neura.state.voiceModeActive = true;

    if (!listenerInstalled) {
      chrome.runtime.onMessage.addListener(onBridgeMessage);
      listenerInstalled = true;
    }

    Neura.voiceOverlay.open({
      onHangUp: close,
      onToggleMute: toggleMute,
      onInterrupt: interrupt,
    });
    probeVoices();
    startListening();
  }

  function close() {
    if (!active) return;
    active = false;
    turnToken += 1;
    muted = false;
    Neura.state.voiceModeActive = false;

    stopBargeInWatch();
    stopPlayback();
    rpc({ action: 'voice:stopSession' }, 10000).catch(() => {});
    setState('idle');
    Neura.voiceOverlay.close();
  }

  Neura.voiceMode = {
    open,
    close,
    interrupt,
    onTurnFinished,
    isActive() {
      return active;
    },
    toSpeechText,
    splitForSpeech,
  };
})(window.Neura);
