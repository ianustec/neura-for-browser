/** @type {Map<string, { added: Set<string>, removed: Set<string> }>} */
const toolOverrides = new Map();

/** @type {Map<string, { removed: Set<string> }>} */
const knowledgeOverrides = new Map();

/**
 * @param {string} modelId
 * @returns {{ added: Set<string>, removed: Set<string> }}
 */
function getOrCreateToolOverride(modelId) {
  const key = String(modelId || '');
  if (!toolOverrides.has(key)) {
    toolOverrides.set(key, { added: new Set(), removed: new Set() });
  }
  return toolOverrides.get(key);
}

/**
 * @param {string} modelId
 * @returns {{ removed: Set<string> }}
 */
function getOrCreateKnowledgeOverride(modelId) {
  const key = String(modelId || '');
  if (!knowledgeOverrides.has(key)) {
    knowledgeOverrides.set(key, { removed: new Set() });
  }
  return knowledgeOverrides.get(key);
}

/**
 * @param {string} modelId
 * @returns {boolean}
 */
export function hasToolOverride(modelId) {
  const key = String(modelId || '');
  return toolOverrides.has(key);
}

/**
 * @param {string} modelId
 * @returns {boolean}
 */
export function hasKnowledgeOverride(modelId) {
  const key = String(modelId || '');
  return knowledgeOverrides.has(key);
}

/**
 * @param {string} modelId
 * @param {string[]} defaultToolIds
 * @returns {string[]}
 */
export function resolveEffectiveToolIds(modelId, defaultToolIds) {
  const defaults = (defaultToolIds || []).map(String).filter(Boolean);
  const override = toolOverrides.get(String(modelId || ''));
  if (!override) return defaults.slice();

  const result = new Set(defaults.filter((id) => !override.removed.has(id)));
  for (const id of override.added) {
    if (id) result.add(String(id));
  }
  return [...result];
}

/**
 * @param {string} modelId
 * @param {string[]} selectedToolIds
 * @param {string[]} defaultToolIds
 */
export function setToolSelection(modelId, selectedToolIds, defaultToolIds) {
  const key = String(modelId || '');
  const defaults = new Set((defaultToolIds || []).map(String).filter(Boolean));
  const selected = new Set((selectedToolIds || []).map(String).filter(Boolean));

  const added = new Set();
  const removed = new Set();

  for (const id of selected) {
    if (!defaults.has(id)) added.add(id);
  }
  for (const id of defaults) {
    if (!selected.has(id)) removed.add(id);
  }

  if (added.size === 0 && removed.size === 0) {
    toolOverrides.delete(key);
    return;
  }

  const override = getOrCreateToolOverride(key);
  override.added = added;
  override.removed = removed;
}

/**
 * @param {string} modelId
 * @param {Array<{ id: string }>} defaultKnowledgeItems
 * @returns {Array<{ id: string, name: string, type: 'collection'|'file', collection_name?: string }>}
 */
export function resolveEffectiveKnowledge(modelId, defaultKnowledgeItems) {
  const items = Array.isArray(defaultKnowledgeItems) ? defaultKnowledgeItems : [];
  const override = knowledgeOverrides.get(String(modelId || ''));
  if (!override || override.removed.size === 0) return items.slice();
  return items.filter((item) => item?.id && !override.removed.has(String(item.id)));
}

/**
 * @param {string} modelId
 * @param {string[]} enabledKnowledgeIds
 * @param {Array<{ id: string }>} defaultKnowledgeItems
 */
export function setKnowledgeSelection(modelId, enabledKnowledgeIds, defaultKnowledgeItems) {
  const key = String(modelId || '');
  const defaults = (defaultKnowledgeItems || []).map((item) => String(item?.id || '')).filter(Boolean);
  const enabled = new Set((enabledKnowledgeIds || []).map(String).filter(Boolean));

  const removed = new Set();
  for (const id of defaults) {
    if (!enabled.has(id)) removed.add(id);
  }

  if (removed.size === 0) {
    knowledgeOverrides.delete(key);
    return;
  }

  const override = getOrCreateKnowledgeOverride(key);
  override.removed = removed;
}

/**
 * Clear all in-memory tool/knowledge overrides for every model.
 * Called when the chat UI is (re)initialized on a fresh page load, so that
 * a page refresh (or exit/re-entry) always shows the model's original
 * OWUI-configured tools instead of a previous session's ad-hoc edits.
 */
export function resetAllOverrides() {
  toolOverrides.clear();
  knowledgeOverrides.clear();
}

/**
 * One-off cleanup when moving from persistent chrome.storage.sync tool selections
 * to in-memory session overrides.
 */
export async function cleanupLegacyToolSelectionStorage() {
  const CLEANUP_KEY = 'neuraToolSelectionStorageCleanup_v2';
  try {
    const { [CLEANUP_KEY]: done } = await chrome.storage.sync.get([CLEANUP_KEY]);
    if (done) return;

    const all = await chrome.storage.sync.get(null);
    const keysToRemove = Object.keys(all || {}).filter(
      (key) =>
        key.startsWith('neuraSelectedTools:') || key === 'neuraToolIdsMigration_noSilentMcp_v1',
    );
    if (keysToRemove.length > 0) {
      await chrome.storage.sync.remove(keysToRemove);
    }
    await chrome.storage.sync.set({ [CLEANUP_KEY]: true });
  } catch (e) {
    console.warn('Neura: legacy tool selection cleanup failed', e);
  }
}
