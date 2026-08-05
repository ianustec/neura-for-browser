/**
 * Offscreen document: microphone capture (MediaRecorder) for dictate and
 * playback of synthesized speech for voice mode.
 * Speaks only with the service worker via chrome.runtime messages.
 */

/** @type {MediaStream|null} */
let mediaStream = null;
/** @type {MediaRecorder|null} */
let mediaRecorder = null;
/** @type {Blob[]} */
let recordedChunks = [];
/** @type {'idle'|'manual'} */
let recordMode = 'idle';
/** @type {string|null} */
let activeRequestId = null;

// End-of-utterance: require real speech, then a short quiet gap before STT.
const SILENCE_RMS_THRESHOLD = 0.018;
const SPEECH_RMS_THRESHOLD = 0.028;
const SILENCE_DURATION_MS = 1100;
const MIN_SPEECH_MS = 280;
const MIN_RECORDING_MS = 500;
const SILENCE_POLL_MS = 80;
const LISTEN_LEVEL_GAIN = 6.5;

/** @type {ReturnType<typeof setInterval>|null} */
let silencePollTimer = null;
/** @type {AudioContext|null} */
let silenceAudioContext = null;

/** Barge-in: mic analyser while the model thinks / speaks (no MediaRecorder). */
const BARGE_IN_RMS_THRESHOLD = 0.05;
const BARGE_IN_HOLD_MS = 160;
const BARGE_IN_POLL_MS = 50;
/** @type {ReturnType<typeof setInterval>|null} */
let bargeInPollTimer = null;
/** @type {AudioContext|null} */
let bargeInAudioContext = null;
let bargeInActive = false;

function reply(requestId, payload) {
  chrome.runtime.sendMessage({
    source: 'offscreen',
    requestId,
    ...payload,
  }).catch(() => {});
}

async function queryMicPermissionState() {
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: 'microphone' });
      return { ok: true, state: status.state || 'unknown' };
    }
  } catch (_) {}
  return { ok: true, state: 'unknown' };
}

function stopSilenceMonitor() {
  if (silencePollTimer) {
    clearInterval(silencePollTimer);
    silencePollTimer = null;
  }
  if (silenceAudioContext) {
    silenceAudioContext.close().catch(() => {});
    silenceAudioContext = null;
  }
  emitAudioLevel(0);
}

function emitSilenceDetected() {
  chrome.runtime.sendMessage({
    source: 'offscreen',
    event: 'voice:silenceDetected',
  }).catch(() => {});
}

function emitBargeIn() {
  chrome.runtime.sendMessage({
    source: 'offscreen',
    event: 'voice:bargeIn',
  }).catch(() => {});
}

function stopBargeInMonitor() {
  bargeInActive = false;
  if (bargeInPollTimer) {
    clearInterval(bargeInPollTimer);
    bargeInPollTimer = null;
  }
  if (bargeInAudioContext) {
    bargeInAudioContext.close().catch(() => {});
    bargeInAudioContext = null;
  }
}

/**
 * Listen for user speech while the assistant is thinking/speaking so the call
 * can interrupt immediately (OpenAI-style barge-in).
 * @param {string} requestId
 */
async function startBargeInMonitor(requestId) {
  stopBargeInMonitor();
  if (recordMode !== 'idle') {
    reply(requestId, { ok: false, error: 'Recording active' });
    return;
  }
  try {
    const stream = await ensureMicStream();
    const audioContext = new AudioContext();
    bargeInAudioContext = audioContext;
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    let speechHoldStarted = 0;
    let fired = false;
    bargeInActive = true;

    bargeInPollTimer = setInterval(() => {
      if (!bargeInActive || fired || recordMode !== 'idle') {
        stopBargeInMonitor();
        return;
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
        return;
      }

      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const sample = (samples[i] - 128) / 128;
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const now = Date.now();

      if (rms >= BARGE_IN_RMS_THRESHOLD) {
        if (!speechHoldStarted) speechHoldStarted = now;
        if (now - speechHoldStarted >= BARGE_IN_HOLD_MS) {
          fired = true;
          stopBargeInMonitor();
          emitBargeIn();
        }
      } else {
        speechHoldStarted = 0;
      }
    }, BARGE_IN_POLL_MS);

    reply(requestId, { ok: true, started: true });
  } catch (err) {
    stopBargeInMonitor();
    reply(requestId, {
      ok: false,
      error: String(err?.message || err),
      permissionDenied:
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError',
    });
  }
}

function startSilenceMonitor(stream) {
  stopSilenceMonitor();
  if (!stream || !stream.active) return;

  const audioContext = new AudioContext();
  silenceAudioContext = audioContext;
  // Offscreen AudioContext often starts suspended; without resume(), RMS stays ~0
  // and end-of-utterance / "hearing" never work.
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }

  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.35;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  const startedAt = Date.now();
  let speechStartedAt = 0;
  let lastSpeechAt = 0;
  let heardSpeech = false;
  let fired = false;

  silencePollTimer = setInterval(() => {
    if (recordMode !== 'manual' || !mediaRecorder || fired) {
      stopSilenceMonitor();
      return;
    }

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
      return;
    }

    analyser.getByteTimeDomainData(samples);
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = (samples[i] - 128) / 128;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    const now = Date.now();

    // Live mic level for the voice-mode mark while listening.
    emitAudioLevel(Math.max(0, Math.min(1.2, rms * LISTEN_LEVEL_GAIN)));

    if (rms >= SPEECH_RMS_THRESHOLD) {
      if (!heardSpeech) {
        heardSpeech = true;
        speechStartedAt = now;
      }
      lastSpeechAt = now;
    } else if (heardSpeech && rms >= SILENCE_RMS_THRESHOLD) {
      // Soft speech / trailing phonemes — keep the utterance open.
      lastSpeechAt = now;
    }

    if (
      heardSpeech &&
      speechStartedAt &&
      now - speechStartedAt >= MIN_SPEECH_MS &&
      now - startedAt >= MIN_RECORDING_MS &&
      now - lastSpeechAt >= SILENCE_DURATION_MS
    ) {
      fired = true;
      emitAudioLevel(0);
      stopSilenceMonitor();
      emitSilenceDetected();
    }
  }, SILENCE_POLL_MS);
}

async function ensureMicStream() {
  if (mediaStream && mediaStream.active) return mediaStream;
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  return mediaStream;
}

function pickRecorderMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

function stopMediaTracks() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch (_) {}
    });
    mediaStream = null;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const idx = dataUrl.indexOf(',');
      resolve(idx >= 0 ? dataUrl.slice(idx + 1) : '');
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read audio'));
    reader.readAsDataURL(blob);
  });
}

async function finishRecording(reason) {
  const requestId = activeRequestId;
  const recorder = mediaRecorder;
  mediaRecorder = null;
  recordMode = 'idle';
  activeRequestId = null;

  if (!recorder) {
    if (requestId) reply(requestId, { ok: false, error: 'No active recorder' });
    return;
  }

  const blob = await new Promise((resolve) => {
    const finalize = () => {
      const type = recordedChunks[0]?.type || recorder.mimeType || 'audio/webm';
      resolve(new Blob(recordedChunks, { type }));
    };
    if (recorder.state === 'inactive') {
      finalize();
      return;
    }
    recorder.addEventListener('stop', finalize, { once: true });
    try {
      recorder.stop();
    } catch (_) {
      finalize();
    }
  });

  recordedChunks = [];
  if (reason === 'session-end') stopMediaTracks();

  if (!blob.size) {
    if (requestId) reply(requestId, { ok: false, error: 'Empty recording' });
    return;
  }

  const base64 = await blobToBase64(blob);
  const payload = {
    ok: true,
    base64,
    mimeType: blob.type || 'audio/webm',
    reason,
  };

  if (requestId) reply(requestId, payload);
}

async function startManualRecording(requestId) {
  if (recordMode !== 'idle') {
    reply(requestId, { ok: false, error: 'Already recording' });
    return;
  }
  try {
    stopBargeInMonitor();
    const stream = await ensureMicStream();
    recordedChunks = [];
    const mimeType = pickRecorderMimeType();
    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
    };
    mediaRecorder.start(250);
    recordMode = 'manual';
    activeRequestId = requestId;
    startSilenceMonitor(stream);
    reply(requestId, { ok: true, started: true });
  } catch (err) {
    stopMediaTracks();
    reply(requestId, {
      ok: false,
      error: String(err?.message || err),
      permissionDenied:
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError',
    });
  }
}

async function stopManualRecording(requestId) {
  stopSilenceMonitor();
  if (recordMode !== 'manual' || !mediaRecorder) {
    reply(requestId, { ok: false, error: 'Not recording' });
    return;
  }
  activeRequestId = requestId;
  await finishRecording('manual-stop');
}

/** @type {HTMLAudioElement|null} */
let playbackAudio = null;
/** @type {string|null} */
let playbackUrl = null;
/** @type {AudioContext|null} */
let playbackAudioContext = null;
/** @type {AnalyserNode|null} */
let playbackAnalyser = null;
/** @type {ReturnType<typeof setInterval>|null} */
let playbackLevelTimer = null;

const PLAYBACK_LEVEL_MS = 40;
const PLAYBACK_RMS_GAIN = 4.2;

function emitPlaybackEnded(error) {
  chrome.runtime.sendMessage({
    source: 'offscreen',
    event: 'voice:playbackEnded',
    error: error || undefined,
  }).catch(() => {});
}

function emitAudioLevel(level) {
  chrome.runtime.sendMessage({
    source: 'offscreen',
    event: 'voice:audioLevel',
    level,
  }).catch(() => {});
}

function stopPlaybackLevelMonitor() {
  if (playbackLevelTimer) {
    clearInterval(playbackLevelTimer);
    playbackLevelTimer = null;
  }
  if (playbackAudioContext) {
    playbackAudioContext.close().catch(() => {});
    playbackAudioContext = null;
  }
  playbackAnalyser = null;
}

function startPlaybackLevelMonitor(audio) {
  stopPlaybackLevelMonitor();
  try {
    const ctx = new AudioContext();
    playbackAudioContext = ctx;
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    playbackAnalyser = analyser;

    const samples = new Uint8Array(analyser.fftSize);
    playbackLevelTimer = setInterval(() => {
      if (!playbackAnalyser || playbackAudio !== audio) {
        stopPlaybackLevelMonitor();
        return;
      }
      playbackAnalyser.getByteTimeDomainData(samples);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const sample = (samples[i] - 128) / 128;
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      // Map typical TTS RMS into a punchy 0..1 envelope for the SVG player.
      const level = Math.max(0, Math.min(1.35, rms * PLAYBACK_RMS_GAIN));
      emitAudioLevel(level);
    }, PLAYBACK_LEVEL_MS);

    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch (_) {
    stopPlaybackLevelMonitor();
  }
}

function releasePlayback() {
  stopPlaybackLevelMonitor();
  emitAudioLevel(0);
  if (playbackAudio) {
    playbackAudio.onended = null;
    playbackAudio.onerror = null;
    try {
      playbackAudio.pause();
    } catch (_) {}
    playbackAudio = null;
  }
  if (playbackUrl) {
    URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;
  }
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'audio/mpeg' });
}

async function playAudio(requestId, base64, mimeType) {
  releasePlayback();
  try {
    playbackUrl = URL.createObjectURL(base64ToBlob(base64, mimeType));
    const audio = new Audio(playbackUrl);
    playbackAudio = audio;
    startPlaybackLevelMonitor(audio);
    audio.onended = () => {
      if (playbackAudio !== audio) return;
      releasePlayback();
      emitPlaybackEnded();
    };
    audio.onerror = () => {
      if (playbackAudio !== audio) return;
      releasePlayback();
      emitPlaybackEnded('Playback failed');
    };
    await audio.play();
    reply(requestId, { ok: true, started: true });
  } catch (err) {
    releasePlayback();
    reply(requestId, { ok: false, error: String(err?.message || err) });
  }
}

function stopPlayback(requestId) {
  releasePlayback();
  if (requestId) reply(requestId, { ok: true, stopped: true });
}

async function stopSession(requestId) {
  stopSilenceMonitor();
  stopBargeInMonitor();
  releasePlayback();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop();
    } catch (_) {}
  }
  mediaRecorder = null;
  recordedChunks = [];
  recordMode = 'idle';
  activeRequestId = null;
  stopMediaTracks();
  reply(requestId, { ok: true, stopped: true });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return;

  const { action, requestId } = message;
  if (action === 'voice:ping') {
    sendResponse({ ok: true, pong: true });
    return true;
  }
  if (action === 'voice:getMicPermissionState') {
    queryMicPermissionState()
      .then((result) => reply(requestId, result))
      .catch((err) =>
        reply(requestId, { ok: false, error: String(err?.message || err), state: 'unknown' }),
      );
    return true;
  }
  if (action === 'voice:startRecording') {
    startManualRecording(requestId);
  } else if (action === 'voice:stopRecording') {
    stopManualRecording(requestId);
  } else if (action === 'voice:startBargeIn') {
    startBargeInMonitor(requestId);
  } else if (action === 'voice:stopBargeIn') {
    stopBargeInMonitor();
    reply(requestId, { ok: true, stopped: true });
  } else if (action === 'voice:playAudio') {
    playAudio(requestId, message.base64, message.mimeType);
  } else if (action === 'voice:stopPlayback') {
    stopPlayback(requestId);
  } else if (action === 'voice:stopSession') {
    stopSession(requestId);
  }
});
