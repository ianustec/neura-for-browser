import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';

const modelFunctionCallingCache = new Map();
/** @type {Map<string, string[]>} */
const modelToolIdsCache = new Map();
/** @type {Map<string, object[]>} */
const modelKnowledgeCache = new Map();

export function invalidateModelMetadataCache() {
  modelFunctionCallingCache.clear();
  modelToolIdsCache.clear();
  modelKnowledgeCache.clear();
}

function normalizeModelsList(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && Array.isArray(json.models)) return json.models;
  return [];
}

function extractFunctionCallingMode(m) {
  if (!m || typeof m !== 'object') return null;
  const raw =
    m.info?.params?.function_calling ??
    m.params?.function_calling ??
    m.model?.info?.params?.function_calling ??
    m.model?.params?.function_calling;
  if (raw === 'native') return 'native';
  if (raw === 'default') return 'default';
  return null;
}

function resolveFunctionCallingFromModelsList(modelsPayload, modelId) {
  const list = normalizeModelsList(modelsPayload);
  const m = list.find((x) => x && (x.id === modelId || x.name === modelId));
  if (!m) return null;
  return extractFunctionCallingMode(m);
}

export function extractModelToolIds(m) {
  if (!m || typeof m !== 'object') return [];
  const candidates = [
    m.info?.meta?.toolIds,
    m.meta?.toolIds,
    m.info?.meta?.tool_ids,
    m.meta?.tool_ids,
    m.toolIds,
    m.tool_ids,
  ];
  /** @type {string[]} */
  let toolIds = [];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      toolIds = c.map(String).filter(Boolean);
      break;
    }
  }

  const actionCandidates = [m.info?.meta?.actionIds, m.meta?.actionIds, m.actionIds];
  /** @type {string[]} */
  const actionIds = [];
  for (const c of actionCandidates) {
    if (Array.isArray(c) && c.length > 0) {
      actionIds.push(...c.map(String).filter(Boolean));
      break;
    }
  }

  if (actionIds.length === 0) return toolIds;
  return [...new Set([...toolIds, ...actionIds])];
}

function resolveToolIdsFromModelsList(modelsPayload, modelId) {
  const list = normalizeModelsList(modelsPayload);
  const m = list.find((x) => x && (x.id === modelId || x.name === modelId));
  if (!m) return [];
  return extractModelToolIds(m);
}

export async function getModelToolIds(modelId) {
  if (modelToolIdsCache.has(modelId)) {
    return modelToolIdsCache.get(modelId);
  }
  try {
    const detail = await fetchModelDetailPayload(modelId);
    let ids = extractModelToolIds(detail);
    if (ids.length === 0) {
      const models = await fetchModelsPayload();
      ids = resolveToolIdsFromModelsList(models, modelId);
    }
    modelToolIdsCache.set(modelId, ids);
    return ids;
  } catch (e) {
    console.warn('Neura: could not fetch model toolIds', e);
    modelToolIdsCache.set(modelId, []);
    return [];
  }
}

/**
 * @param {object|null|undefined} item
 * @returns {{ id: string, name: string, type: 'collection'|'file', collection_name?: string }|null}
 */
function normalizeKnowledgeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item.id != null ? String(item.id) : '';
  if (!id) return null;
  const rawType = String(item.type || '').toLowerCase();
  const type = rawType === 'file' ? 'file' : 'collection';
  const name =
    item.name ||
    item.filename ||
    item.meta?.name ||
    item.collection?.name ||
    id;
  const collectionName =
    item.collection_name ||
    item.collectionName ||
    (item.collection && typeof item.collection === 'object' ? item.collection.name : undefined);
  return {
    id,
    name: String(name),
    type,
    ...(collectionName ? { collection_name: String(collectionName) } : {}),
  };
}

/**
 * @param {object|null|undefined} m
 * @returns {Array<{ id: string, name: string, type: 'collection'|'file', collection_name?: string }>}
 */
export function extractModelKnowledge(m) {
  if (!m || typeof m !== 'object') return [];
  const candidates = [m.info?.meta?.knowledge, m.meta?.knowledge];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      return c.map(normalizeKnowledgeItem).filter(Boolean);
    }
  }
  return [];
}

export async function getModelKnowledge(modelId) {
  if (modelKnowledgeCache.has(modelId)) {
    return modelKnowledgeCache.get(modelId);
  }
  try {
    const detail = await fetchModelDetailPayload(modelId);
    const items = extractModelKnowledge(detail);
    modelKnowledgeCache.set(modelId, items);
    return items;
  } catch (e) {
    console.warn('Neura: could not fetch model knowledge', e);
    modelKnowledgeCache.set(modelId, []);
    return [];
  }
}

export async function fetchModelDetailPayload(modelId) {
  const { MODEL_DETAIL_ENDPOINT } = await getEndpoints();
  const response = await apiFetch(MODEL_DETAIL_ENDPOINT(modelId), { method: 'GET' });
  if (!response.ok) return null;
  return response.json();
}

async function fetchModelsPayload() {
  const { MODELS_ENDPOINT } = await getEndpoints();
  const response = await apiFetch(MODELS_ENDPOINT, { method: 'GET' });
  if (!response.ok) throw new Error('Failed to fetch models');
  return response.json();
}

export async function getModelFunctionCalling(modelId) {
  if (modelFunctionCallingCache.has(modelId)) {
    return modelFunctionCallingCache.get(modelId);
  }
  try {
    const models = await fetchModelsPayload();
    let mode = resolveFunctionCallingFromModelsList(models, modelId);

    if (mode !== 'native') {
      const detail = await fetchModelDetailPayload(modelId);
      const detailMode = detail ? extractFunctionCallingMode(detail) : null;
      if (detailMode === 'native') mode = 'native';
      else if (detailMode === 'default') mode = 'default';
    }

    const finalMode = mode === 'native' ? 'native' : 'default';
    modelFunctionCallingCache.set(modelId, finalMode);
    return finalMode;
  } catch (e) {
    console.warn('Neura: could not fetch model metadata for function calling', e);
    modelFunctionCallingCache.set(modelId, 'default');
    return 'default';
  }
}
