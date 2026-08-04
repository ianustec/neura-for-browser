const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
const OFFSCREEN_URL = () => chrome.runtime.getURL(OFFSCREEN_PATH);

/** @type {number|null} */
let activeVoiceTabId = null;

/** @type {Map<string, { resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout> }>} */
const pending = new Map();

function makeRequestId() {
  return `vr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @returns {Promise<boolean>}
 */
async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) {
    const clients = await self.clients?.matchAll?.({ type: 'window' }).catch(() => []) || [];
    return clients.some((c) => c.url && c.url.includes(OFFSCREEN_PATH));
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL()],
  });
  return contexts.length > 0;
}

/**
 * Ensure a single offscreen document exists for microphone capture.
 * @returns {Promise<void>}
 */
export async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Microphone capture for dictate and speech playback for voice mode',
  });
  // Brief settle so the offscreen listener is registered before the first message.
  await new Promise((r) => setTimeout(r, 50));
}

/**
 * @param {number|null|undefined} tabId
 */
export function setActiveVoiceTab(tabId) {
  activeVoiceTabId = tabId ?? null;
}

export function getActiveVoiceTab() {
  return activeVoiceTabId;
}

/**
 * Send a message to the offscreen document and optionally wait for a correlated reply.
 * @param {object} message
 * @param {{ waitFor?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<object|void>}
 */
export async function sendToOffscreen(message, opts = {}) {
  await ensureOffscreenDocument();
  const requestId = makeRequestId();
  const payload = { ...message, requestId, target: 'offscreen' };

  if (!opts.waitFor) {
    await chrome.runtime.sendMessage(payload).catch(() => {});
    return;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Offscreen voice operation timed out'));
    }, opts.timeoutMs || 120000);

    pending.set(requestId, { resolve, reject, timer });
    chrome.runtime.sendMessage(payload).catch((err) => {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(err);
    });
  });
}

/**
 * Handle replies / events originating from the offscreen document.
 * @param {object} message
 * @returns {boolean} true if handled
 */
export function handleOffscreenMessage(message) {
  if (!message || message.source !== 'offscreen') return false;

  const requestId = message.requestId;
  if (requestId && pending.has(requestId)) {
    const entry = pending.get(requestId);
    pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve(message);
    return true;
  }

  // Push events to the content tab that owns the voice session.
  const tabId = activeVoiceTabId;
  if (tabId != null && message.event) {
    chrome.tabs.sendMessage(tabId, {
      action: message.event,
      ...message,
      source: 'voice-bridge',
    }).catch(() => {});
  }
  return true;
}

/**
 * Query microphone permission state for the extension offscreen origin.
 * @returns {Promise<{ ok: boolean, state?: string, error?: string }>}
 */
export async function getMicPermissionState() {
  return sendToOffscreen(
    { action: 'voice:getMicPermissionState' },
    { waitFor: true, timeoutMs: 5000 },
  );
}
