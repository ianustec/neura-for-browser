import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';
import { getModelToolIds } from './model-metadata.js';
import {
  hasToolOverride,
  resolveEffectiveToolIds,
  setToolSelection,
} from './session-overrides.js';

/** @type {{ list: object[]|null, fetchedAt: number }} */
let toolsCache = { list: null, fetchedAt: 0 };
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * @returns {Promise<object[]>}
 */
export async function fetchToolsList() {
  if (toolsCache.list && Date.now() - toolsCache.fetchedAt < CACHE_TTL_MS) {
    return toolsCache.list;
  }
  try {
    const { TOOLS } = await getEndpoints();
    const response = await apiFetch(TOOLS, { method: 'GET' });
    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    toolsCache = { list, fetchedAt: Date.now() };
    return list;
  } catch (e) {
    console.warn('Neura: could not fetch tools list', e);
    return [];
  }
}

export function invalidateToolsCache() {
  toolsCache = { list: null, fetchedAt: 0 };
}

/**
 * Model presets can include MCP ids (`server:mcp:*`) that are not returned by
 * GET /api/v1/tools/. Add synthetic rows so the picker shows every default.
 * @param {object[]} toolsList
 * @param {string[]} defaultToolIds
 * @returns {object[]}
 */
export function mergeToolsForPicker(toolsList, defaultToolIds) {
  const list = Array.isArray(toolsList) ? toolsList.filter(Boolean) : [];
  const known = new Set(list.map((t) => String(t?.id || '')).filter(Boolean));
  const merged = list.slice();

  for (const rawId of defaultToolIds || []) {
    const id = String(rawId || '');
    if (!id || known.has(id)) continue;

    const isMcp = id.startsWith('server:mcp:') || id.startsWith('server:');
    const name = isMcp
      ? id.replace(/^server:mcp:/, 'MCP · ').replace(/^server:/, 'Server · ')
      : id.replace(/_/g, ' ');

    merged.push({
      id,
      name,
      meta: {
        description: isMcp
          ? 'Integrazione MCP preimpostata su questo modello'
          : 'Tool preimpostato su questo modello',
      },
      synthetic: true,
    });
    known.add(id);
  }

  return merged;
}

/**
 * Effective tool selection for a model (OWUI defaults + in-memory session override).
 * @param {string} modelId
 * @returns {Promise<string[]>}
 */
export async function getSelectedToolsForModel(modelId) {
  const defaults = await getModelToolIds(modelId);
  return resolveEffectiveToolIds(modelId, defaults);
}

/**
 * @param {string} modelId
 * @param {string[]} toolIds
 */
export async function setSelectedToolsForModel(modelId, toolIds) {
  const defaults = await getModelToolIds(modelId);
  setToolSelection(modelId, toolIds, defaults);
}

/**
 * Resolve tool_ids for a chat/completions request (Conduit-aligned).
 * Model defaults come from OWUI; session overrides apply until the service worker restarts.
 *
 * @param {string} modelId
 * @param {string[]} modelDefaultToolIds
 * @param {string[]} userSelectedToolIds
 * @param {boolean} [_useKnowledge] reserved; built-in knowledge tools come from the server
 * @returns {Promise<string[]>}
 */
export async function resolveToolIdsForRequest(
  modelId,
  modelDefaultToolIds,
  userSelectedToolIds,
  _useKnowledge,
) {
  const effective = resolveEffectiveToolIds(modelId, modelDefaultToolIds || []);

  // Until the user changes the picker this session, always send OWUI defaults.
  if (!hasToolOverride(modelId)) {
    return effective;
  }

  if (Array.isArray(userSelectedToolIds)) {
    return userSelectedToolIds.filter(Boolean).map(String);
  }

  return effective;
}
