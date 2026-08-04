import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';

/**
 * @param {object} chatBlob
 * @param {string|null} [folderId]
 * @returns {Promise<object|null>}
 */
export async function createChat(chatBlob, folderId = null) {
  try {
    const { NEW_CHAT_ENDPOINT } = await getEndpoints();
    const response = await apiFetch(NEW_CHAT_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ chat: chatBlob, folder_id: folderId }),
    });
    if (!response.ok) {
      console.warn('[Neura] createChat failed', response.status);
      return null;
    }
    return response.json();
  } catch (e) {
    console.warn('[Neura] createChat error', e);
    return null;
  }
}

/**
 * @param {string} id
 * @param {object} chatBlob
 * @returns {Promise<object|null>}
 */
export async function updateChat(id, chatBlob) {
  if (!id) return null;
  try {
    const { CHAT_BY_ID } = await getEndpoints();
    const response = await apiFetch(CHAT_BY_ID(id), {
      method: 'POST',
      body: JSON.stringify({ chat: chatBlob }),
    });
    if (!response.ok) {
      console.warn('[Neura] updateChat failed', response.status);
      return null;
    }
    return response.json();
  } catch (e) {
    console.warn('[Neura] updateChat error', e);
    return null;
  }
}

/**
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getChat(id) {
  if (!id) return null;
  try {
    const { CHAT_BY_ID } = await getEndpoints();
    const response = await apiFetch(CHAT_BY_ID(id), { method: 'GET' });
    if (!response.ok) {
      console.warn('[Neura] getChat failed', response.status);
      return null;
    }
    return response.json();
  } catch (e) {
    console.warn('[Neura] getChat error', e);
    return null;
  }
}

/**
 * @param {number} [page]
 * @returns {Promise<object[]>}
 */
export async function listChats(page = 1) {
  try {
    const { CHATS_LIST } = await getEndpoints();
    // Match Open WebUI webapp: Recenti excludes chats that live in folders.
    const response = await apiFetch(
      `${CHATS_LIST}?page=${page}&include_folders=false`,
      { method: 'GET' },
    );
    if (!response.ok) {
      console.warn('[Neura] listChats failed', response.status);
      return [];
    }
    const data = await response.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.chats)) return data.chats;
    return [];
  } catch (e) {
    console.warn('[Neura] listChats error', e);
    return [];
  }
}

/**
 * List all non-folder chats across pages (OWUI paginates ~60/page).
 * @returns {Promise<object[]>}
 */
export async function listAllChats() {
  const all = [];
  const pageSizeHint = 60;
  for (let page = 1; page < 100; page++) {
    const batch = await listChats(page);
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < pageSizeHint) break;
  }
  return all;
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteChat(id) {
  if (!id) return false;
  try {
    const { CHAT_BY_ID } = await getEndpoints();
    const response = await apiFetch(CHAT_BY_ID(id), { method: 'DELETE' });
    return response.ok;
  } catch (e) {
    console.warn('[Neura] deleteChat error', e);
    return false;
  }
}

/**
 * @param {number} [page]
 * @returns {Promise<object[]>}
 */
export async function listPinnedChats() {
  try {
    const { CHATS_PINNED } = await getEndpoints();
    const response = await apiFetch(CHATS_PINNED, { method: 'GET' });
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  } catch (e) {
    console.warn('[Neura] listPinnedChats error', e);
    return [];
  }
}

/**
 * @param {number} [page]
 * @returns {Promise<object[]>}
 */
export async function listArchivedChats(page = 1) {
  try {
    const { CHATS_ARCHIVED } = await getEndpoints();
    const response = await apiFetch(`${CHATS_ARCHIVED}?page=${page}`, { method: 'GET' });
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  } catch (e) {
    console.warn('[Neura] listArchivedChats error', e);
    return [];
  }
}

/**
 * Collect remote chat ids from paginated list + archived endpoints.
 * @returns {Promise<string[]>}
 */
async function listAllRemoteChatIds() {
  const ids = new Set();
  const pageSizeHint = 60;

  for (let page = 1; page < 100; page++) {
    const batch = await listChats(page);
    if (!batch.length) break;
    for (const c of batch) {
      const id = c.id || c.chat_id;
      if (id) ids.add(String(id));
    }
    if (batch.length < pageSizeHint) break;
  }

  for (let page = 1; page < 100; page++) {
    const batch = await listArchivedChats(page);
    if (!batch.length) break;
    for (const c of batch) {
      const id = c.id || c.chat_id;
      if (id) ids.add(String(id));
    }
    if (batch.length < pageSizeHint) break;
  }

  return [...ids];
}

/**
 * Delete every chat owned by the authenticated user on the server,
 * except pinned chats.
 * @returns {Promise<{ ok: boolean, keptRemoteIds: string[], deletedCount: number }>}
 */
export async function deleteAllChats() {
  try {
    const pinned = await listPinnedChats();
    const keptRemoteIds = pinned
      .map((c) => c.id || c.chat_id)
      .filter(Boolean)
      .map(String);
    const pinnedSet = new Set(keptRemoteIds);

    const allIds = await listAllRemoteChatIds();
    const toDelete = allIds.filter((id) => !pinnedSet.has(id));

    let deletedCount = 0;
    let ok = true;
    for (const id of toDelete) {
      const deleted = await deleteChat(id);
      if (deleted) deletedCount += 1;
      else ok = false;
    }

    return { ok, keptRemoteIds, deletedCount };
  } catch (e) {
    console.warn('[Neura] deleteAllChats error', e);
    return { ok: false, keptRemoteIds: [], deletedCount: 0 };
  }
}

/**
 * Toggles pin state server-side (Open WebUI's endpoint is a stateless toggle).
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function togglePinChat(id) {
  if (!id) return false;
  try {
    const { CHAT_PIN } = await getEndpoints();
    const response = await apiFetch(CHAT_PIN(id), { method: 'POST' });
    return response.ok;
  } catch (e) {
    console.warn('[Neura] togglePinChat error', e);
    return false;
  }
}

/**
 * Toggles archive state server-side (stateless toggle).
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function toggleArchiveChat(id) {
  if (!id) return false;
  try {
    const { CHAT_ARCHIVE } = await getEndpoints();
    const response = await apiFetch(CHAT_ARCHIVE(id), { method: 'POST' });
    return response.ok;
  } catch (e) {
    console.warn('[Neura] toggleArchiveChat error', e);
    return false;
  }
}

/**
 * @param {string} text
 * @returns {Promise<object[]>}
 */
export async function searchChats(text) {
  try {
    const { CHAT_SEARCH } = await getEndpoints();
    const params = new URLSearchParams();
    if (text) params.set('text', text);
    const response = await apiFetch(`${CHAT_SEARCH}?${params}`, { method: 'GET' });
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  } catch (e) {
    console.warn('[Neura] searchChats error', e);
    return [];
  }
}

/**
 * @param {string} id
 * @returns {Promise<object[]>}
 */
export async function getChatTags(id) {
  if (!id) return [];
  try {
    const { CHAT_TAGS } = await getEndpoints();
    const response = await apiFetch(CHAT_TAGS(id), { method: 'GET' });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[Neura] getChatTags error', e);
    return [];
  }
}

/**
 * @param {string} id
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function addChatTag(id, name) {
  if (!id || !name) return false;
  try {
    const { CHAT_TAGS } = await getEndpoints();
    const response = await apiFetch(CHAT_TAGS(id), {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return response.ok;
  } catch (e) {
    console.warn('[Neura] addChatTag error', e);
    return false;
  }
}

/**
 * @param {string} id
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function removeChatTag(id, name) {
  if (!id || !name) return false;
  try {
    const { CHAT_TAGS } = await getEndpoints();
    const response = await apiFetch(CHAT_TAGS(id), {
      method: 'DELETE',
      body: JSON.stringify({ name }),
    });
    return response.ok;
  } catch (e) {
    console.warn('[Neura] removeChatTag error', e);
    return false;
  }
}

/**
 * @returns {Promise<object[]>}
 */
export async function getAllTags() {
  try {
    const { ALL_TAGS } = await getEndpoints();
    const response = await apiFetch(ALL_TAGS, { method: 'GET' });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[Neura] getAllTags error', e);
    return [];
  }
}

/**
 * @param {string} chatId
 * @param {string} messageId
 * @returns {Promise<boolean>}
 */
export async function deleteChatMessage(chatId, messageId) {
  if (!chatId || !messageId) return false;
  try {
    const { CHAT_DELETE_MESSAGE } = await getEndpoints();
    const response = await apiFetch(CHAT_DELETE_MESSAGE(chatId, messageId), { method: 'DELETE' });
    return response.ok;
  } catch (e) {
    console.warn('[Neura] deleteChatMessage error', e);
    return false;
  }
}

/**
 * @param {string} id
 * @returns {Promise<{ id: string }|null>}
 */
export async function shareChat(id) {
  if (!id) return null;
  try {
    const { CHAT_SHARE } = await getEndpoints();
    const response = await apiFetch(CHAT_SHARE(id), { method: 'POST' });
    if (!response.ok) return null;
    return response.json();
  } catch (e) {
    console.warn('[Neura] shareChat error', e);
    return null;
  }
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function unshareChat(id) {
  if (!id) return false;
  try {
    const { CHAT_SHARE } = await getEndpoints();
    const response = await apiFetch(CHAT_SHARE(id), { method: 'DELETE' });
    return response.ok;
  } catch (e) {
    console.warn('[Neura] unshareChat error', e);
    return false;
  }
}

/**
 * @param {string} id
 * @param {{ title?: string|null }} [opts]
 * @returns {Promise<object|null>}
 */
export async function cloneChat(id, opts = {}) {
  if (!id) return null;
  try {
    const { CHAT_CLONE } = await getEndpoints();
    // Open WebUI requires CloneForm JSON body (title optional); empty POST → 422.
    const body = {};
    if (opts.title != null && String(opts.title).trim()) {
      body.title = String(opts.title).trim();
    }
    const response = await apiFetch(CHAT_CLONE(id), {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.warn('[Neura] cloneChat failed', response.status, detail);
      return null;
    }
    return response.json();
  } catch (e) {
    console.warn('[Neura] cloneChat error', e);
    return null;
  }
}

/**
 * @returns {Promise<object[]>}
 */
export async function listFolders() {
  try {
    const { FOLDERS } = await getEndpoints();
    const response = await apiFetch(FOLDERS, { method: 'GET' });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[Neura] listFolders error', e);
    return [];
  }
}

/**
 * @param {string} name
 * @param {{ parentId?: string|null }} [opts]
 * @returns {Promise<object|null>}
 */
export async function createFolder(name, opts = {}) {
  if (!name) return null;
  try {
    const { FOLDERS } = await getEndpoints();
    const body = { name: String(name).trim() };
    if (opts.parentId) body.parent_id = opts.parentId;
    const response = await apiFetch(FOLDERS, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return response.json();
  } catch (e) {
    console.warn('[Neura] createFolder error', e);
    return null;
  }
}

/**
 * Create nested folders from a path like "test/test1/test2".
 * @param {string} path
 * @param {string|null} [parentId]
 * @returns {Promise<object|null>} deepest folder created/found
 */
export async function createFolderPath(path, parentId = null) {
  const parts = String(path || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  const all = await listFolders();
  let currentParent = parentId || null;
  let last = null;

  for (const part of parts) {
    const existing = all.find(
      (f) =>
        f &&
        String(f.name || '').toLowerCase() === part.toLowerCase() &&
        String(f.parent_id || '') === String(currentParent || ''),
    );
    if (existing) {
      last = existing;
      currentParent = existing.id;
      continue;
    }
    const created = await createFolder(part, { parentId: currentParent });
    if (!created?.id) return last;
    all.push(created);
    last = created;
    currentParent = created.id;
  }
  return last;
}

/**
 * @param {string} id
 * @param {{ name?: string }} patch
 * @returns {Promise<object|null>}
 */
export async function updateFolder(id, patch = {}) {
  if (!id) return null;
  try {
    const { FOLDER_UPDATE } = await getEndpoints();
    const body = {};
    if (patch.name != null) body.name = String(patch.name).trim();
    const response = await apiFetch(FOLDER_UPDATE(id), {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return response.json();
  } catch (e) {
    console.warn('[Neura] updateFolder error', e);
    return null;
  }
}

/**
 * @param {string} id
 * @param {string|null} parentId
 * @returns {Promise<object|null>}
 */
export async function updateFolderParent(id, parentId) {
  if (!id) return null;
  try {
    const { FOLDER_UPDATE_PARENT } = await getEndpoints();
    const response = await apiFetch(FOLDER_UPDATE_PARENT(id), {
      method: 'POST',
      body: JSON.stringify({ parent_id: parentId || null }),
    });
    if (!response.ok) return null;
    return response.json();
  } catch (e) {
    console.warn('[Neura] updateFolderParent error', e);
    return null;
  }
}

/**
 * @param {string} id
 * @param {{ deleteContents?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
export async function deleteFolder(id, opts = {}) {
  if (!id) return false;
  try {
    const { FOLDER_BY_ID } = await getEndpoints();
    const deleteContents = opts.deleteContents === true;
    const url = `${FOLDER_BY_ID(id)}?delete_contents=${deleteContents ? 'true' : 'false'}`;
    const response = await apiFetch(url, { method: 'DELETE' });
    return response.ok;
  } catch (e) {
    console.warn('[Neura] deleteFolder error', e);
    return false;
  }
}

/**
 * Duplicate a folder (and optionally its subtree + chats) under the same parent.
 * @param {string} folderId
 * @param {{ includeChats?: boolean, includeChildren?: boolean }} [opts]
 * @returns {Promise<object|null>} new root folder
 */
export async function duplicateFolder(folderId, opts = {}) {
  if (!folderId) return null;
  const includeChats = opts.includeChats !== false;
  const includeChildren = opts.includeChildren !== false;

  const all = await listFolders();
  const source = all.find((f) => f && f.id === folderId);
  if (!source) return null;

  async function cloneNode(src, parentId, isRoot) {
    const copyName = isRoot ? `${src.name || 'Folder'} (copy)` : src.name || 'Folder';
    const created = await createFolder(copyName, { parentId: parentId || null });
    if (!created?.id) return null;

    if (includeChats) {
      const { CHATS_BY_FOLDER } = await getEndpoints();
      const response = await apiFetch(CHATS_BY_FOLDER(src.id), { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        const chats = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
        for (const chat of chats) {
          const chatId = chat.id || chat.chat_id;
          if (!chatId) continue;
          const cloned = await cloneChat(chatId, {
            title: chat.title || undefined,
          });
          const newId = cloned?.id || cloned?.chat_id || cloned?.chat?.id;
          if (newId) await moveChatToFolder(newId, created.id);
        }
      }
    }

    if (includeChildren) {
      const children = all.filter((f) => f && String(f.parent_id || '') === String(src.id));
      for (const child of children) {
        await cloneNode(child, created.id, false);
      }
    }
    return created;
  }

  return cloneNode(source, source.parent_id || null, true);
}

/**
 * @param {string} chatId
 * @param {string|null} folderId
 * @returns {Promise<boolean>}
 */
export async function moveChatToFolder(chatId, folderId) {
  if (!chatId) return false;
  try {
    const { CHAT_MOVE_FOLDER } = await getEndpoints();
    const response = await apiFetch(CHAT_MOVE_FOLDER(chatId), {
      method: 'POST',
      body: JSON.stringify({ folder_id: folderId || null }),
    });
    return response.ok;
  } catch (e) {
    console.warn('[Neura] moveChatToFolder error', e);
    return false;
  }
}

/**
 * @param {object} payload
 * @returns {Promise<object|null>}
 */
export async function completeChatTurn(payload) {
  try {
    const { CHAT_COMPLETED_ENDPOINT } = await getEndpoints();
    const response = await apiFetch(CHAT_COMPLETED_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn('[Neura] completeChatTurn failed', response.status);
      return null;
    }
    return response.json();
  } catch (e) {
    console.warn('[Neura] completeChatTurn error', e);
    return null;
  }
}
