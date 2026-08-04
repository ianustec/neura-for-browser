import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';

const CACHE_KEY = 'neuraModelIconCache';
const TTL_MS = 30 * 60 * 1000;
const MAX_BYTES = 2_500_000;

/** @type {Map<string, { dataUrl: string, fetchedAt: number }>} */
const memoryCache = new Map();

/**
 * @param {ArrayBuffer} buffer
 * @param {string} contentType
 */
function bufferToDataUrl(buffer, contentType) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  const ct = contentType && contentType.startsWith('image/') ? contentType : 'image/png';
  return `data:${ct};base64,${b64}`;
}

/**
 * @param {Response} response
 * @param {string} url
 */
function isUsableImageResponse(response, url) {
  if (!response?.ok) return false;
  const ct = String(response.headers.get('content-type') || '').toLowerCase();
  if (ct.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/i.test(url);
}

/**
 * @param {string} modelId
 * @param {string|null|undefined} profileImageUrl
 */
function cacheKey(modelId, profileImageUrl) {
  const id = String(modelId || '').trim();
  if (profileImageUrl && String(profileImageUrl).startsWith('data:image')) {
    return `data:${id}`;
  }
  return id;
}

/**
 * @param {string} key
 * @returns {Promise<string|null>}
 */
async function readPersisted(key) {
  try {
    const { [CACHE_KEY]: bag } = await chrome.storage.local.get([CACHE_KEY]);
    const entry = bag && typeof bag === 'object' ? bag[key] : null;
    if (entry?.dataUrl && entry?.fetchedAt && Date.now() - entry.fetchedAt < TTL_MS) {
      return entry.dataUrl;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {string} key
 * @param {string} dataUrl
 */
async function writePersisted(key, dataUrl) {
  try {
    const { [CACHE_KEY]: bag } = await chrome.storage.local.get([CACHE_KEY]);
    const next = bag && typeof bag === 'object' ? { ...bag } : {};
    next[key] = { dataUrl, fetchedAt: Date.now() };
    const keys = Object.keys(next);
    if (keys.length > 40) {
      keys
        .sort((a, b) => (next[a].fetchedAt || 0) - (next[b].fetchedAt || 0))
        .slice(0, keys.length - 40)
        .forEach((k) => delete next[k]);
    }
    await chrome.storage.local.set({ [CACHE_KEY]: next });
  } catch {
    /* ignore quota */
  }
}

/**
 * @param {string} url
 * @param {boolean} authenticated
 * @returns {Promise<string|null>}
 */
async function fetchAsDataUrl(url, authenticated) {
  const response = authenticated
    ? await apiFetch(url, { method: 'GET', redirect: 'follow' })
    : await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow' });
  if (!isUsableImageResponse(response, url)) return null;
  const ct = String(response.headers.get('content-type') || '').toLowerCase();
  const buf = await response.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX_BYTES) return null;
  return bufferToDataUrl(buf, ct || 'image/png');
}

/**
 * Resolve a model's OWUI profile image to a data URL.
 * Prefer the dedicated OWUI endpoint so we match the parent model logo exactly.
 *
 * @param {{ modelId: string, profileImageUrl?: string|null, force?: boolean }} opts
 * @returns {Promise<{ ok: boolean, dataUrl: string|null, modelId: string }>}
 */
export async function getModelProfileImage(opts = {}) {
  const modelId = String(opts.modelId || '').trim();
  if (!modelId) return { ok: false, dataUrl: null, modelId: '' };

  const profileImageUrl =
    opts.profileImageUrl != null ? String(opts.profileImageUrl).trim() : '';
  const key = cacheKey(modelId, profileImageUrl);
  const force = opts.force === true;

  if (!force) {
    const mem = memoryCache.get(key);
    if (mem?.dataUrl && Date.now() - mem.fetchedAt < TTL_MS) {
      return { ok: true, dataUrl: mem.dataUrl, modelId };
    }
    const persisted = await readPersisted(key);
    if (persisted) {
      memoryCache.set(key, { dataUrl: persisted, fetchedAt: Date.now() });
      return { ok: true, dataUrl: persisted, modelId };
    }
  }

  if (profileImageUrl.startsWith('data:image')) {
    memoryCache.set(key, { dataUrl: profileImageUrl, fetchedAt: Date.now() });
    await writePersisted(key, profileImageUrl);
    return { ok: true, dataUrl: profileImageUrl, modelId };
  }

  try {
    const { MODEL_PROFILE_IMAGE, BASE_URL } = await getEndpoints();
    let dataUrl = await fetchAsDataUrl(MODEL_PROFILE_IMAGE(modelId), true);

    if (!dataUrl && profileImageUrl) {
      let url = profileImageUrl;
      if (!/^https?:\/\//i.test(url) && !url.startsWith('data:')) {
        const base = String(BASE_URL || '').replace(/\/+$/, '');
        url = `${base}${url.startsWith('/') ? url : `/${url}`}`;
      }
      if (url.startsWith('http')) {
        dataUrl = await fetchAsDataUrl(url, /^https?:\/\//i.test(profileImageUrl) === false);
      }
    }

    if (!dataUrl) return { ok: false, dataUrl: null, modelId };

    memoryCache.set(key, { dataUrl, fetchedAt: Date.now() });
    await writePersisted(key, dataUrl);
    return { ok: true, dataUrl, modelId };
  } catch (e) {
    console.warn('[Neura] model profile image failed', modelId, e);
    return { ok: false, dataUrl: null, modelId };
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.neuraAPIEndpoint) {
    memoryCache.clear();
    chrome.storage.local.remove([CACHE_KEY]).catch(() => {});
  }
});
