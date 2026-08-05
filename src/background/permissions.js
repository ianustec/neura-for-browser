import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';
import { getServerConfig } from './openwebui-config.js';

/** @type {{ data: object|null, fetchedAt: number }} */
let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<object|null>}
 */
export async function fetchUserPermissions() {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  try {
    const { PERMISSIONS } = await getEndpoints();
    const response = await apiFetch(PERMISSIONS, { method: 'GET' });
    if (!response.ok) return null;
    const data = await response.json();
    cache = { data, fetchedAt: Date.now() };
    return data;
  } catch (e) {
    console.warn('Neura: could not fetch user permissions', e);
    return null;
  }
}

export function invalidatePermissionsCache() {
  cache = { data: null, fetchedAt: 0 };
}

/**
 * @param {string} featureName
 * @param {object|null} modelCapabilities
 * @param {object|null} serverFeatures
 * @param {object|null} userPermissions
 * @returns {boolean}
 */
export function canUseFeature(featureName, modelCapabilities, serverFeatures, userPermissions) {
  const globalMap = {
    web_search: 'enable_web_search',
    image_generation: 'enable_image_generation',
    code_interpreter: 'enable_code_interpreter',
  };

  const globalKey = globalMap[featureName];
  if (globalKey && serverFeatures && serverFeatures[globalKey] === false) {
    return false;
  }

  const userFeatures = userPermissions?.features || userPermissions?.permissions?.features;
  if (userFeatures && userFeatures[featureName] === false) {
    return false;
  }

  if (modelCapabilities && modelCapabilities[featureName] === false) {
    return false;
  }

  return true;
}

/**
 * @param {object|null} modelItem
 * @returns {Promise<{ web_search: boolean, image_generation: boolean, code_interpreter: boolean, memory: boolean }>}
 */
export async function getAvailableFeatures(modelItem) {
  const caps =
    modelItem?.meta?.capabilities ||
    modelItem?.info?.meta?.capabilities ||
    {};

  const serverConfig = await getServerConfig();
  const serverFeatures = serverConfig?.features || {};
  const permissions = await fetchUserPermissions();

  return {
    web_search: canUseFeature('web_search', caps, serverFeatures, permissions),
    image_generation: canUseFeature('image_generation', caps, serverFeatures, permissions),
    code_interpreter: canUseFeature('code_interpreter', caps, serverFeatures, permissions),
    memory: canUseFeature('memory', caps, serverFeatures, permissions),
  };
}
