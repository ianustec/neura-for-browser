import { hasKnowledgeOverride, resolveEffectiveKnowledge } from './session-overrides.js';

/**
 * @param {{ id: string, name: string, type: 'collection'|'file', collection_name?: string }|null|undefined} item
 * @returns {object|null}
 */
export function knowledgeItemToFileDescriptor(item) {
  if (!item?.id) return null;
  if (item.type === 'collection') {
    return {
      type: 'collection',
      id: item.id,
      name: item.name || item.id,
      collection_name: item.id,
    };
  }
  return {
    type: 'file',
    id: item.id,
    name: item.name || item.id,
    url: item.id,
    knowledge: true,
    ...(item.collection_name ? { collection_name: item.collection_name } : {}),
  };
}

/**
 * @param {string} modelId
 * @param {Array<{ id: string, name: string, type: 'collection'|'file', collection_name?: string }>} modelDefaultKnowledge
 * @param {string[]|null|undefined} userEnabledKnowledgeIds
 * @returns {object[]}
 */
export function resolveKnowledgeFilesForRequest(
  modelId,
  modelDefaultKnowledge,
  userEnabledKnowledgeIds,
) {
  let effectiveItems;

  if (Array.isArray(userEnabledKnowledgeIds)) {
    if (userEnabledKnowledgeIds.length === 0 && !hasKnowledgeOverride(modelId)) {
      effectiveItems = resolveEffectiveKnowledge(modelId, modelDefaultKnowledge);
    } else if (userEnabledKnowledgeIds.length === 0) {
      effectiveItems = [];
    } else {
      const enabled = new Set(userEnabledKnowledgeIds.map(String));
      effectiveItems = (modelDefaultKnowledge || []).filter((item) => enabled.has(String(item.id)));
    }
  } else {
    effectiveItems = resolveEffectiveKnowledge(modelId, modelDefaultKnowledge);
  }

  return effectiveItems.map(knowledgeItemToFileDescriptor).filter(Boolean);
}
