import { ensureAuthenticated, getToken } from './auth.js';

/**
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Promise<Record<string, string>>}
 */
export async function getAuthHeaders(extraHeaders = {}) {
  const token = await getToken();
  if (!token) {
    throw new Error('Non autenticato. Accedi dalle impostazioni Neura.');
  }
  return {
    ...extraHeaders,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Authenticated fetch for Open WebUI API. Retries once after re-login on 401.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function apiFetch(url, options = {}) {
  const doFetch = async () => {
    const headers = await getAuthHeaders(options.headers || {});
    if (
      !(options.body instanceof FormData) &&
      !headers['Content-Type'] &&
      options.method &&
      options.method !== 'GET' &&
      options.method !== 'HEAD' &&
      typeof options.body === 'string'
    ) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, { ...options, headers });
  };

  let response = await doFetch();
  if (response.status === 401) {
    await ensureAuthenticated();
    response = await doFetch();
  }
  return response;
}
