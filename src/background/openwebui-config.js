import { getEndpoints, normalizeApiEndpoint, STORAGE_KEYS } from './constants.js';

const CONFIG_TTL_MS = 60 * 60 * 1000;

/**
 * @param {Response} response
 * @returns {Promise<boolean>}
 */
async function isOpenWebUIHealthOk(response) {
  if (!response.ok) return false;
  const text = (await response.text()).trim();
  if (text === 'true') return true;
  try {
    const json = JSON.parse(text);
    return json?.status === true;
  } catch {
    return false;
  }
}

/** @param {Response} response */
export async function isOpenWebUIInstance(response) {
  return isOpenWebUIHealthOk(response);
}

/**
 * Derive server base URL from a chat completions endpoint or bare base URL.
 * @param {string} apiEndpoint
 */
export function baseUrlFromEndpoint(apiEndpoint) {
  const raw = normalizeApiEndpoint(apiEndpoint);
  if (!raw) return '';
  return raw.replace(/\/api\/chat\/completions\/?$/i, '').replace(/\/+$/, '');
}

/**
 * @param {string} [baseUrlOverride]
 * @returns {Promise<{ ok: boolean, version?: string, features?: object, oauth?: object, error?: string }>}
 */
export async function probeServerConfig(baseUrlOverride) {
  let baseUrl = String(baseUrlOverride || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    const endpoints = await getEndpoints();
    baseUrl = endpoints.BASE_URL;
  }
  if (!baseUrl || !baseUrl.startsWith('http')) {
    return { ok: false, error: 'URL non valido.' };
  }

  try {
    const healthRes = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      cache: 'no-store',
    });
    const healthOk = await isOpenWebUIHealthOk(healthRes);
    if (!healthOk) {
      return {
        ok: false,
        error: `Health check fallito (${healthRes.status}): URL non raggiungibile o non Open WebUI.`,
      };
    }

    const configRes = await fetch(`${baseUrl}/api/config`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!configRes.ok) {
      return { ok: false, error: `GET /api/config ha risposto ${configRes.status}.` };
    }

    const config = await configRes.json();
    const result = {
      ok: true,
      version: config.version || 'unknown',
      name: config.name || config.webui_name || null,
      logo: config.logo || config.logo_url || config.favicon || config.favicon_url || null,
      features: config.features || {},
      oauth: config.oauth || {},
      probedAt: Date.now(),
      baseUrl,
    };

    try {
      await saveServerConfig(result);
    } catch (saveErr) {
      console.warn('Neura: could not cache server config', saveErr);
    }
    return result;
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * Probe using the stored or provided chat completions URL.
 * @param {string} apiEndpoint
 */
export async function probeServerFromEndpoint(apiEndpoint) {
  const baseUrl = baseUrlFromEndpoint(apiEndpoint);
  if (!baseUrl.startsWith('http')) {
    return { ok: false, error: 'URL non valido.' };
  }
  return probeServerConfig(baseUrl);
}

/**
 * @returns {Promise<object|null>}
 */
export async function getCachedServerConfig() {
  const { [STORAGE_KEYS.OWUI_SERVER_CONFIG]: config } = await chrome.storage.local.get([
    STORAGE_KEYS.OWUI_SERVER_CONFIG,
  ]);
  if (!config?.probedAt) return null;
  if (Date.now() - config.probedAt > CONFIG_TTL_MS) return null;
  return config;
}

/**
 * @param {object} config
 */
export async function saveServerConfig(config) {
  await chrome.storage.local.set({ [STORAGE_KEYS.OWUI_SERVER_CONFIG]: config });
}

/**
 * @returns {Promise<object|null>}
 */
export async function getServerConfig() {
  const cached = await getCachedServerConfig();
  if (cached) return cached;
  try {
    const probe = await Promise.race([
      probeServerConfig(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 8000)),
    ]);
    return probe.ok ? probe : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} raw
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseServerVersion(raw) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(raw || ''));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] || 0) };
}

/**
 * @param {unknown} raw server version string
 * @param {[number, number, number]} target
 * @returns {boolean | null} null when the version cannot be determined
 */
export function isVersionAtLeast(raw, target) {
  const v = parseServerVersion(raw);
  if (!v) return null;
  const [tMajor, tMinor, tPatch] = target;
  if (v.major !== tMajor) return v.major > tMajor;
  if (v.minor !== tMinor) return v.minor > tMinor;
  return v.patch >= tPatch;
}

/**
 * Protocol capabilities of the connected Open WebUI server.
 *
 * `null` means "unknown" (version missing or unparsable): callers must probe at
 * runtime instead of assuming, so the extension keeps working against any server.
 *
 * - chatActive: `chat:active` socket event (since 0.8.0)
 * - chatScopedTaskStop: POST /api/tasks/chat/{id}/stop; /api/tasks/stop/{task_id}
 *   became admin-only in the same release (since 0.9.0)
 * - loadsHistoryFromDb: with `chat_id` + `parent_id` the server rebuilds the
 *   conversation from its database instead of expecting it in the request
 *   (since 0.7.0)
 * - persistsTurns: /api/chat/completions writes the user message, the assistant
 *   placeholder and then the content, `output`, sources, follow-ups and usage on
 *   its own (since 0.9.0). Up to 0.8.12 the client had to save the chat itself.
 *
 * @returns {Promise<{ version: string|null, chatActive: boolean|null, chatScopedTaskStop: boolean|null, loadsHistoryFromDb: boolean|null, persistsTurns: boolean|null }>}
 */
export async function getServerCapabilities() {
  const cached = await getCachedServerConfig();
  if (!cached) {
    // Warm the cache for subsequent turns without blocking this one.
    getServerConfig().catch(() => {});
  }
  const version = cached?.version && cached.version !== 'unknown' ? cached.version : null;
  return {
    version,
    chatActive: isVersionAtLeast(version, [0, 8, 0]),
    chatScopedTaskStop: isVersionAtLeast(version, [0, 9, 0]),
    loadsHistoryFromDb: isVersionAtLeast(version, [0, 7, 0]),
    persistsTurns: isVersionAtLeast(version, [0, 9, 0]),
  };
}

/**
 * Human-readable feature flags for settings UI.
 * @param {object} features
 */
export function formatServerFeatures(features) {
  if (!features || typeof features !== 'object') return [];
  const labels = {
    enable_web_search: 'Web search',
    enable_notes: 'Notes',
    enable_image_generation: 'Image generation',
    enable_code_interpreter: 'Code interpreter',
  };
  return Object.entries(labels)
    .filter(([key]) => features[key] === true)
    .map(([, label]) => label);
}
