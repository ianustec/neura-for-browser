import { getEndpoints } from './constants.js';
import { getServerConfig, probeServerConfig } from './openwebui-config.js';

const LOGO_CACHE_KEY = 'neuraOwuiLogoCache';
const LOGO_TTL_MS = 30 * 60 * 1000;

/** Known OWUI static branding paths (custom installs replace these files). */
const LOGO_CANDIDATES = [
  '/static/favicon.png',
  '/static/favicon.svg',
  '/static/logo.png',
  '/static/splash.png',
  '/static/favicon-96x96.png',
  '/static/apple-touch-icon.png',
  '/favicon.png',
  '/favicon.ico',
];

/**
 * @param {string} baseUrl
 * @param {string} pathOrUrl
 */
function resolveUrl(baseUrl, pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

/**
 * @param {Response} response
 */
function isUsableLogoResponse(response, url) {
  if (!response?.ok) return false;
  const ct = String(response.headers.get('content-type') || '').toLowerCase();
  if (ct.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/i.test(url);
}

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
 * @returns {Promise<{ dataUrl: string|null, url: string|null, name: string|null, baseUrl: string|null }>}
 */
export async function getOwUiBranding(opts = {}) {
  const force = opts.force === true;
  if (!force) {
    try {
      const { [LOGO_CACHE_KEY]: cached } = await chrome.storage.local.get([LOGO_CACHE_KEY]);
      if (cached?.dataUrl && cached?.fetchedAt && Date.now() - cached.fetchedAt < LOGO_TTL_MS) {
        return {
          dataUrl: cached.dataUrl,
          url: cached.url || null,
          name: cached.name || null,
          baseUrl: cached.baseUrl || null,
        };
      }
    } catch (e) {
      /* ignore */
    }
  }

  const endpoints = await getEndpoints();
  const baseUrl = endpoints.BASE_URL;
  if (!baseUrl) {
    return { dataUrl: null, url: null, name: null, baseUrl: null };
  }

  let name = null;
  /** @type {string[]} */
  const candidates = [];

  try {
    const config = (await getServerConfig()) || (await probeServerConfig(baseUrl));
    if (config?.ok !== false) {
      name = config?.name || config?.webui_name || null;
      const fromConfig = [
        config?.logo,
        config?.favicon,
        config?.favicon_url,
        config?.logo_url,
        config?.ui?.logo,
        config?.ui?.favicon,
      ].filter(Boolean);
      for (const item of fromConfig) candidates.push(resolveUrl(baseUrl, item));
    }
  } catch (e) {
    /* continue with static candidates */
  }

  for (const path of LOGO_CANDIDATES) {
    candidates.push(resolveUrl(baseUrl, path));
  }

  const seen = new Set();
  for (const url of candidates) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const response = await fetch(url, { method: 'GET', cache: 'no-store' });
      if (!isUsableLogoResponse(response, url)) continue;
      const ct = String(response.headers.get('content-type') || '').toLowerCase();
      const buf = await response.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 2_500_000) continue;
      const dataUrl = bufferToDataUrl(buf, ct || 'image/png');
      const payload = {
        dataUrl,
        url,
        name,
        baseUrl,
        fetchedAt: Date.now(),
      };
      try {
        await chrome.storage.local.set({ [LOGO_CACHE_KEY]: payload });
      } catch (e) {
        /* ignore quota */
      }
      return {
        dataUrl,
        url,
        name,
        baseUrl,
      };
    } catch (e) {
      /* try next */
    }
  }

  return { dataUrl: null, url: null, name, baseUrl };
}

// Drop cached OWUI logo when the configured server URL changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.neuraAPIEndpoint) {
    chrome.storage.local.remove([LOGO_CACHE_KEY]).catch(() => {});
  }
});
