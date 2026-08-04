import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.prompts)) return data.prompts;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function extractTagNames(raw) {
  const tags = raw?.tags || raw?.meta?.tags || [];
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (typeof t === 'string' ? t : t?.name || ''))
    .filter(Boolean)
    .map((t) => String(t).toLowerCase());
}

function normalizePrompt(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const commandRaw = String(raw.command || '').trim();
  const command = commandRaw ? (commandRaw.startsWith('/') ? commandRaw : `/${commandRaw}`) : '';
  const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
  const tags = extractTagNames(raw);
  return {
    id: raw.id || null,
    command,
    title: raw.name || raw.title || command || 'Prompt',
    content: raw.content || '',
    description: '',
    tags,
    meta,
    raw,
  };
}

export async function listPrompts() {
  try {
    const { PROMPTS, PROMPTS_LIST } = await getEndpoints();
    let response = await apiFetch(PROMPTS_LIST, { method: 'GET' });
    if (!response.ok) {
      response = await apiFetch(PROMPTS, { method: 'GET' });
    }
    if (!response.ok) {
      console.warn('[Neura] listPrompts failed', response.status);
      return [];
    }
    const data = await response.json();
    return asArray(data).map(normalizePrompt).filter(Boolean);
  } catch (e) {
    console.warn('[Neura] listPrompts error', e);
    return [];
  }
}

export async function searchPrompts(query = '') {
  try {
    const q = String(query || '').trim();
    const { PROMPTS_LIST } = await getEndpoints();
    const url = q
      ? `${PROMPTS_LIST}?query=${encodeURIComponent(q)}`
      : PROMPTS_LIST;
    const response = await apiFetch(url, { method: 'GET' });
    if (!response.ok) {
      // Fallback: client-side filter on full list
      const all = await listPrompts();
      if (!q) return all;
      const lower = q.toLowerCase();
      return all.filter(
        (p) =>
          p.command.toLowerCase().includes(lower) ||
          p.title.toLowerCase().includes(lower) ||
          p.content.toLowerCase().includes(lower),
      );
    }
    const data = await response.json();
    return asArray(data).map(normalizePrompt).filter(Boolean);
  } catch (e) {
    console.warn('[Neura] searchPrompts error', e);
    return [];
  }
}

/**
 * Create (or upsert) a prompt on the Open WebUI server.
 * @param {{ command?: string, name?: string, title?: string, content?: string,
 *   tags?: string[], meta?: object }} opts
 * @returns {Promise<{ ok: boolean, prompt?: object, error?: string }>}
 */
export async function createPrompt(opts = {}) {
  try {
    const { PROMPTS_CREATE } = await getEndpoints();
    const bareCommand = String(opts.command || '').replace(/^\//, '').trim();
    if (!bareCommand) return { ok: false, error: 'missing_command' };

    const tagNames = new Set(
      (Array.isArray(opts.tags) ? opts.tags : []).map((t) =>
        typeof t === 'string' ? t : t?.name || '',
      ),
    );

    const meta = { ...(opts.meta || {}) };
    meta.tags = Array.from(tagNames).map((name) => ({ name }));

    const body = {
      command: bareCommand,
      name: String(opts.name || opts.title || bareCommand).trim(),
      content: String(opts.content || ''),
      meta,
      access_control: null,
    };

    const response = await apiFetch(PROMPTS_CREATE, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        if (err?.detail) detail = String(err.detail);
      } catch {
        /* ignore */
      }
      return { ok: false, error: detail };
    }
    const prompt = normalizePrompt(await response.json());
    return { ok: true, prompt };
  } catch (e) {
    console.warn('[Neura] createPrompt error', e);
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * Permanently delete a prompt by id (Open WebUI DELETE /api/v1/prompts/id/{id}/delete).
 * @param {string} promptId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function deletePromptById(promptId) {
  try {
    const id = String(promptId || '').trim();
    if (!id) return { ok: false, error: 'missing_id' };

    const { PROMPT_DELETE } = await getEndpoints();
    const response = await apiFetch(PROMPT_DELETE(id), { method: 'DELETE' });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        if (err?.detail) detail = String(err.detail);
      } catch {
        /* ignore */
      }
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[Neura] deletePromptById error', e);
    return { ok: false, error: String(e.message || e) };
  }
}

export async function getPromptByCommand(command) {
  try {
    const cmd = String(command || '').replace(/^\//, '').trim();
    if (!cmd) return null;
    const { PROMPT_BY_COMMAND } = await getEndpoints();
    const response = await apiFetch(PROMPT_BY_COMMAND(cmd), { method: 'GET' });
    if (!response.ok) {
      const all = await listPrompts();
      const needle = `/${cmd}`.toLowerCase();
      return all.find((p) => p.command.toLowerCase() === needle) || null;
    }
    return normalizePrompt(await response.json());
  } catch (e) {
    console.warn('[Neura] getPromptByCommand error', e);
    return null;
  }
}
