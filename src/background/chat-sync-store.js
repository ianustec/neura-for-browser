const SYNC_MAP_KEY = 'neuraChatSyncMap';

/**
 * @returns {Promise<{ mappings: Record<string, object>, byRemote: Record<string, string> }>}
 */
async function loadMap() {
  const { [SYNC_MAP_KEY]: raw } = await chrome.storage.local.get([SYNC_MAP_KEY]);
  if (!raw || typeof raw !== 'object') {
    return { mappings: {}, byRemote: {} };
  }
  return {
    mappings: raw.mappings && typeof raw.mappings === 'object' ? raw.mappings : {},
    byRemote: raw.byRemote && typeof raw.byRemote === 'object' ? raw.byRemote : {},
  };
}

async function saveMap(map) {
  await chrome.storage.local.set({ [SYNC_MAP_KEY]: map });
}

/**
 * @param {string} localId
 * @returns {Promise<object|null>}
 */
export async function getMapping(localId) {
  if (!localId) return null;
  const map = await loadMap();
  return map.mappings[localId] || null;
}

/**
 * @param {string} localId
 * @param {string} remoteId
 * @param {'synced'|'pending'|'error'|'local-only'} [status]
 * @returns {Promise<void>}
 */
export async function setMapping(localId, remoteId, status = 'synced') {
  if (!localId || !remoteId) return;
  const map = await loadMap();
  const prev = map.mappings[localId];
  if (prev?.remoteId && prev.remoteId !== remoteId) {
    delete map.byRemote[prev.remoteId];
  }
  const now = Date.now();
  map.mappings[localId] = {
    remoteId,
    status,
    lastPushAt: status === 'synced' || status === 'pending' ? now : (prev?.lastPushAt || 0),
    lastPullAt: prev?.lastPullAt || 0,
  };
  map.byRemote[remoteId] = localId;
  await saveMap(map);
}

/**
 * @param {string} remoteId
 * @returns {Promise<string|null>}
 */
export async function getLocalIdByRemote(remoteId) {
  if (!remoteId) return null;
  const map = await loadMap();
  return map.byRemote[remoteId] || null;
}

/**
 * @returns {Promise<Record<string, object>>}
 */
export async function allMappings() {
  const map = await loadMap();
  return map.mappings;
}

/**
 * @param {string} localId
 * @returns {Promise<void>}
 */
export async function removeMapping(localId) {
  if (!localId) return;
  const map = await loadMap();
  const entry = map.mappings[localId];
  if (entry?.remoteId) delete map.byRemote[entry.remoteId];
  delete map.mappings[localId];
  await saveMap(map);
}

/**
 * @param {string} localId
 * @param {'synced'|'pending'|'error'|'local-only'} status
 * @returns {Promise<void>}
 */
export async function setSyncStatus(localId, status) {
  const map = await loadMap();
  if (!map.mappings[localId]) return;
  map.mappings[localId].status = status;
  if (status === 'synced') map.mappings[localId].lastPushAt = Date.now();
  await saveMap(map);
}

/**
 * @param {string} localId
 * @returns {Promise<void>}
 */
export async function markPulled(localId) {
  const map = await loadMap();
  if (!map.mappings[localId]) return;
  map.mappings[localId].lastPullAt = Date.now();
  map.mappings[localId].status = 'synced';
  await saveMap(map);
}

/**
 * Wipe every local<->remote chat mapping (used by the "delete all chats" flow).
 * @returns {Promise<void>}
 */
export async function clearAll() {
  await saveMap({ mappings: {}, byRemote: {} });
}

/**
 * Keep only mappings whose remoteId is in `keptRemoteIds`; drop the rest.
 * @param {Iterable<string>} keptRemoteIds
 * @returns {Promise<void>}
 */
export async function clearExceptRemoteIds(keptRemoteIds) {
  const keep = new Set([...(keptRemoteIds || [])].map(String).filter(Boolean));
  if (keep.size === 0) {
    await clearAll();
    return;
  }
  const map = await loadMap();
  const next = { mappings: {}, byRemote: {} };
  for (const [localId, entry] of Object.entries(map.mappings || {})) {
    const remoteId = entry?.remoteId ? String(entry.remoteId) : '';
    if (!remoteId || !keep.has(remoteId)) continue;
    next.mappings[localId] = entry;
    next.byRemote[remoteId] = localId;
  }
  await saveMap(next);
}
