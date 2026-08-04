import { getEndpoints } from './constants.js';

/** @typedef {{ jwt: string, user: object }} NeuraSession */

export const STORAGE_KEYS = {
  SESSION: 'neuraSession',
  // Legacy key from the "remember me" feature, kept only so it can be purged
  // from installs that still have it (see purgeLegacyStoredCredentials).
  CREDENTIALS: 'neuraCredentials',
};

const LEGACY_STORAGE_KEYS = [STORAGE_KEYS.CREDENTIALS, 'neuraCredentialEncKey'];

/**
 * @returns {Promise<NeuraSession|null>}
 */
export async function getSession() {
  const { [STORAGE_KEYS.SESSION]: session } = await chrome.storage.local.get([STORAGE_KEYS.SESSION]);
  if (!session?.jwt) return null;
  return session;
}

/**
 * @returns {Promise<string|null>}
 */
export async function getToken() {
  const session = await getSession();
  return session?.jwt || null;
}

/**
 * @returns {Promise<boolean>}
 */
export async function isLoggedIn() {
  const token = await getToken();
  if (!token) return false;
  try {
    const user = await validateSession(token);
    return !!user;
  } catch {
    return false;
  }
}

/**
 * @param {string} token
 * @returns {Promise<object|null>}
 */
async function validateSession(token) {
  const { AUTH_ME } = await getEndpoints();
  const response = await fetch(AUTH_ME, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json();
}

/**
 * The extension never persists the password: it exchanges it for a session
 * JWT at login time and keeps only that token. When the JWT expires, the
 * user signs in again from Settings — there is no silent re-auth.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ ok: true, user: object }>}
 */
export async function signIn(email, password) {
  const trimmedEmail = String(email || '').trim();
  const trimmedPassword = String(password || '');

  if (!trimmedEmail || !trimmedPassword) {
    throw new Error('Inserisci email e password.');
  }

  const { SIGNIN } = await getEndpoints();
  const response = await fetch(SIGNIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: trimmedEmail, password: trimmedPassword }),
  });

  if (!response.ok) {
    let message = 'Credenziali non valide o server non raggiungibile.';
    try {
      const err = await response.json();
      if (err?.detail) message = String(err.detail);
      else if (err?.message) message = String(err.message);
    } catch {
      const text = await response.text();
      if (text) message = text.slice(0, 200);
    }
    throw new Error(message);
  }

  const data = await response.json();
  const jwt = data.token || data.access_token;
  if (!jwt) {
    throw new Error('Risposta di login non valida: token mancante.');
  }

  const user = await validateSession(jwt);
  if (!user) {
    throw new Error('Login riuscito ma sessione non valida.');
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.SESSION]: { jwt, user } });
  await purgeLegacyStoredCredentials();

  return { ok: true, user };
}

/**
 * Refresh user profile from GET /api/v1/auths/ and persist in storage.
 * @returns {Promise<object|null>}
 */
export async function refreshUserProfile() {
  const session = await getSession();
  if (!session?.jwt) return null;
  const user = await validateSession(session.jwt);
  if (!user) return null;
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: { jwt: session.jwt, user },
  });
  return user;
}

/**
 * @returns {Promise<void>}
 */
export async function signOut() {
  const token = await getToken();
  if (token) {
    try {
      const { SIGNOUT } = await getEndpoints();
      await fetch(SIGNOUT, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      console.warn('Neura: signout request failed', e);
    }
  }
  await chrome.storage.local.remove([STORAGE_KEYS.SESSION, ...LEGACY_STORAGE_KEYS]);
}

/**
 * One-time cleanup: remove any password ever saved by the old "remember me"
 * feature (plain-text or encrypted) plus its encryption key.
 * @returns {Promise<void>}
 */
export async function purgeLegacyStoredCredentials() {
  const stored = await chrome.storage.local.get(LEGACY_STORAGE_KEYS);
  const toRemove = LEGACY_STORAGE_KEYS.filter((key) => stored[key] !== undefined);
  if (toRemove.length) {
    await chrome.storage.local.remove(toRemove);
    console.info('Neura: removed legacy stored password data', toRemove);
  }
}

/**
 * Validates the current JWT and refreshes the cached user profile.
 * Does NOT re-authenticate with stored credentials — there are none anymore.
 * @returns {Promise<string>}
 */
export async function ensureAuthenticated() {
  const session = await getSession();
  if (session?.jwt) {
    const user = await validateSession(session.jwt);
    if (user) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.SESSION]: { jwt: session.jwt, user },
      });
      return session.jwt;
    }
  }

  throw new Error('Sessione scaduta. Accedi di nuovo dalle impostazioni.');
}

/**
 * Remove legacy API key from sync storage (one-time migration).
 * @returns {Promise<void>}
 */
export async function migrateLegacyApiKey() {
  const data = await chrome.storage.sync.get(['neuraAPIKey']);
  if (data.neuraAPIKey) {
    await chrome.storage.sync.remove('neuraAPIKey');
  }
}

/**
 * @returns {Promise<{ loggedIn: boolean, user?: object }>}
 */
export async function getAuthStatus() {
  const session = await getSession();
  if (!session?.jwt) {
    return { loggedIn: false };
  }
  const user = await validateSession(session.jwt);
  if (!user) {
    return { loggedIn: false };
  }
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: { jwt: session.jwt, user },
  });
  return { loggedIn: true, user };
}

/**
 * @returns {Promise<object|null>}
 */
export async function getCurrentUser() {
  const session = await getSession();
  if (!session?.jwt) return null;
  if (session.user) {
    const fresh = await validateSession(session.jwt);
    if (fresh) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.SESSION]: { jwt: session.jwt, user: fresh },
      });
      return fresh;
    }
  }
  const user = await validateSession(session.jwt);
  if (!user) return null;
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: { jwt: session.jwt, user },
  });
  return user;
}

void purgeLegacyStoredCredentials().catch((err) => {
  console.warn('Neura: legacy credential purge failed', err);
});
