import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';

/**
 * @param {string} base64
 * @param {string} [mimeType]
 * @returns {Blob}
 */
export function base64ToBlob(base64, mimeType = 'application/octet-stream') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/**
 * @param {Blob|ArrayBuffer} data
 * @returns {Promise<string>}
 */
export async function blobToBase64(data) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Transcribe audio via Open WebUI STT.
 * @param {Blob|ArrayBuffer} audioData
 * @param {{ fileName?: string, mimeType?: string, language?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function transcribeAudio(audioData, opts = {}) {
  const { AUDIO_TRANSCRIPTIONS } = await getEndpoints();
  const mimeType = opts.mimeType || (audioData instanceof Blob ? audioData.type : '') || 'audio/webm';
  const ext = mimeType.includes('mp4') || mimeType.includes('m4a')
    ? 'm4a'
    : mimeType.includes('wav')
      ? 'wav'
      : mimeType.includes('mpeg') || mimeType.includes('mp3')
        ? 'mp3'
        : 'webm';
  const fileName = opts.fileName || `recording.${ext}`;
  const blob =
    audioData instanceof Blob
      ? audioData
      : new Blob([audioData], { type: mimeType });

  const formData = new FormData();
  formData.append('file', blob, fileName);
  if (opts.language) formData.append('language', opts.language);

  const response = await apiFetch(AUDIO_TRANSCRIPTIONS, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Transcription failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  const text =
    (typeof data?.text === 'string' && data.text) ||
    (typeof data?.transcription === 'string' && data.transcription) ||
    '';
  return String(text).trim();
}

/**
 * Voices exposed by the TTS engine configured on Open WebUI.
 * An empty list means the server cannot synthesize speech (e.g. the instance
 * uses the browser-side WebAPI engine), so callers should fall back locally.
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export async function listVoices() {
  const { AUDIO_VOICES } = await getEndpoints();
  const response = await apiFetch(AUDIO_VOICES, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Voices unavailable (${response.status})`);
  }
  const data = await response.json();
  const raw = Array.isArray(data) ? data : data?.voices || [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return { id: entry, name: entry };
      const id = entry?.id || entry?.voice_id || entry?.name || '';
      return { id: String(id), name: String(entry?.name || id) };
    })
    .filter((voice) => voice.id);
}

/**
 * Synthesize speech via Open WebUI TTS.
 * @param {string} text
 * @param {{ voice?: string, model?: string }} [opts]
 * @returns {Promise<{ base64: string, mimeType: string }>}
 */
export async function synthesizeSpeech(text, opts = {}) {
  const input = String(text || '').trim();
  if (!input) throw new Error('Empty text');

  const { AUDIO_SPEECH } = await getEndpoints();
  const payload = { input };
  if (opts.voice) payload.voice = opts.voice;
  if (opts.model) payload.model = opts.model;

  const response = await apiFetch(AUDIO_SPEECH, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Speech failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new Error('Empty audio response');
  const mimeType = response.headers.get('content-type') || 'audio/mpeg';
  return { base64: await blobToBase64(buffer), mimeType };
}
