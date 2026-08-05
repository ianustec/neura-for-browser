import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';
import { dlog, dwarn } from './debug-log.js';

/** Soft cap before upload so Files API / RAG stay bounded. */
export const MAX_PAGE_CONTEXT_CHARS = 50000;
const PAGE_CONTEXT_CACHE_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { fileId: string, attachment: object, fetchedAt: number }>} */
const pageContextCache = new Map();

/**
 * @param {Blob|ArrayBuffer} fileData
 * @param {string} fileName
 * @param {{ process?: boolean, contentType?: string }} [opts]
 * @returns {Promise<object>}
 */
export async function uploadFile(fileData, fileName, opts = {}) {
  const endpoints = await getEndpoints();
  const url = opts.process ? endpoints.FILES_UPLOAD_PROCESS : endpoints.FILES_UPLOAD;
  const formData = new FormData();
  const type = opts.contentType || undefined;
  const blob =
    fileData instanceof Blob
      ? fileData
      : new Blob([fileData], type ? { type } : undefined);
  formData.append('file', blob, fileName);

  const response = await apiFetch(url, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * @param {string} text
 * @returns {string}
 */
function hashText(text) {
  const s = String(text || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * @param {string} name
 * @returns {string}
 */
function safeTxtFilename(name) {
  const base = String(name || 'page')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
  const stem = base.replace(/\.txt$/i, '') || 'page';
  return `${stem}.txt`;
}

/**
 * @param {{ title?: string, url?: string, description?: string, text?: string }} ctx
 * @returns {string}
 */
export function formatPageContextDocument(ctx) {
  const title = String(ctx?.title || '').trim();
  const url = String(ctx?.url || '').trim();
  const description = String(ctx?.description || '').trim();
  let body = String(ctx?.text || '').trim();
  if (body.length > MAX_PAGE_CONTEXT_CHARS) {
    body = `${body.slice(0, MAX_PAGE_CONTEXT_CHARS)}\n\n[truncated]`;
  }
  const lines = [];
  if (title) lines.push(`Title: ${title}`);
  if (url) lines.push(`URL: ${url}`);
  if (description) lines.push(`Description: ${description}`);
  lines.push('', body || description || '');
  return lines.join('\n');
}

/**
 * Source URL stamped on page/web file attachments for dedup.
 * @param {object|null|undefined} file
 * @returns {string}
 */
export function getAttachmentSourceUrl(file) {
  if (!file || typeof file !== 'object') return '';
  const candidates = [
    file.sourceUrl,
    file.source_url,
    file.meta?.sourceUrl,
    file.meta?.source_url,
    file.meta?.source,
    file.url && String(file.url).startsWith('http') ? file.url : '',
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return '';
}

/**
 * True if files[] already contains this OWUI file id or the same page URL.
 * @param {object[]} files
 * @param {{ id?: string, url?: string }} needle
 */
export function pageContextAlreadyInFiles(files, needle) {
  const list = Array.isArray(files) ? files : [];
  const id = needle?.id != null ? String(needle.id) : '';
  const url = needle?.url != null ? String(needle.url).trim() : '';
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    if (id && (f.id === id || f.url === id)) return true;
    if (url) {
      const src = getAttachmentSourceUrl(f);
      if (src && src === url) return true;
      if (f.name === url) return true;
    }
  }
  return false;
}

/**
 * Upload arbitrary plain text as an OWUI file (process=true for RAG).
 * @param {string} content
 * @param {{ name?: string, sourceUrl?: string }} [opts]
 * @returns {Promise<object>} OWUI file descriptor { type:'file', id, ... }
 */
export async function uploadTextContentAsFile(content, opts = {}) {
  const body = String(content || '');
  if (!body.trim()) throw new Error('Empty text content');
  const truncated =
    body.length > MAX_PAGE_CONTEXT_CHARS
      ? `${body.slice(0, MAX_PAGE_CONTEXT_CHARS)}\n\n[truncated]`
      : body;
  const displayName = opts.name || 'document.txt';
  const fileName = safeTxtFilename(displayName);
  const blob = new Blob([truncated], { type: 'text/plain' });
  const uploaded = await uploadFile(blob, fileName, {
    process: true,
    contentType: 'text/plain',
  });
  const fileId = uploaded?.id || uploaded?.file_id;
  if (!fileId) throw new Error('Upload succeeded but no file id returned');
  const attachment = await enrichFileAttachment(fileId, {
    name: displayName,
    contentType: 'text/plain',
  });
  if (opts.sourceUrl) {
    attachment.sourceUrl = opts.sourceUrl;
    attachment.meta = { ...(attachment.meta || {}), source: opts.sourceUrl };
  }
  return attachment;
}

/**
 * Scrape payload → OWUI file. Cached by url+content hash.
 * @param {{ title?: string, url?: string, description?: string, text?: string }} pageContext
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<object>}
 */
export async function uploadPageContextAsFile(pageContext, opts = {}) {
  const url = String(pageContext?.url || '').trim();
  const title = String(pageContext?.title || url || 'page').trim();
  const text = String(pageContext?.text || '').trim();
  const description = String(pageContext?.description || '').trim();
  if (!text && !description) {
    throw new Error('Page context has no text to upload');
  }

  const documentText = formatPageContextDocument({
    title,
    url,
    description,
    text: text || description,
  });
  const cacheKey = `${url || title}::${hashText(documentText)}`;

  if (!opts.force) {
    const hit = pageContextCache.get(cacheKey);
    if (hit?.attachment && Date.now() - hit.fetchedAt < PAGE_CONTEXT_CACHE_TTL_MS) {
      dlog('page-context', 'cache hit', {
        fileId: hit.fileId,
        url,
        title,
        chars: documentText.length,
      });
      return hit.attachment;
    }
  }

  dlog('page-context', 'uploading to OWUI Files API', {
    title,
    url,
    chars: documentText.length,
    force: !!opts.force,
  });

  const attachment = await uploadTextContentAsFile(documentText, {
    name: title.endsWith('.txt') ? title : `${title}.txt`,
    sourceUrl: url || undefined,
  });
  if (title) attachment.name = title;
  attachment.context = 'page';
  if (url) attachment.sourceUrl = url;

  pageContextCache.set(cacheKey, {
    fileId: String(attachment.id),
    attachment,
    fetchedAt: Date.now(),
  });
  dlog('page-context', 'Files API returned', {
    fileId: attachment.id,
    name: attachment.name,
    content_type: attachment.content_type,
  });
  return attachment;
}

/**
 * Upload a `data:` image (e.g. a vision screenshot) to the OWUI Files API so
 * it can be referenced by a stable file id/URL everywhere else — never
 * persisted or sent as a raw base64 string in chat content.
 * @param {string} dataUrl
 * @param {{ name?: string, context?: string }} [opts]
 * @returns {Promise<object>} OWUI file descriptor { type:'image', id, url, ... }
 */
export async function uploadImageDataUrlAsFile(dataUrl, opts = {}) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('Expected a data: URL image');
  }
  const match = /^data:([^;,]+)/.exec(dataUrl);
  const contentType = (match && match[1]) || 'image/jpeg';
  const blob = await (await fetch(dataUrl)).blob();
  const ext = contentType.split('/')[1] || 'jpg';
  const fileName = opts.name || `screenshot-${Date.now()}.${ext}`;

  dlog('vision', 'uploading screenshot to OWUI Files API', {
    fileName,
    contentType,
    bytes: blob.size,
  });

  const uploaded = await uploadFile(blob, fileName, { contentType });
  const fileId = uploaded?.id || uploaded?.file_id;
  if (!fileId) throw new Error('Screenshot upload succeeded but no file id returned');
  const attachment = await enrichFileAttachment(fileId, { name: fileName, contentType });
  if (opts.context) attachment.context = opts.context;

  dlog('vision', 'screenshot Files API upload ok', {
    fileId: attachment.id,
    name: attachment.name,
    content_type: attachment.content_type,
  });
  return attachment;
}

/**
 * Build a Conduit-style file descriptor from upload response + GET /files/{id}.
 * @param {string} fileId
 * @param {{ name?: string, contentType?: string }} [fallback]
 * @returns {Promise<object>}
 */
export async function enrichFileAttachment(fileId, fallback = {}) {
  if (!fileId) throw new Error('Missing file id');
  let meta = null;
  try {
    meta = await getFileMetadata(fileId);
  } catch (e) {
    console.warn('[Neura] getFileMetadata failed; using upload fallback', e);
  }

  const contentType =
    meta?.meta?.content_type ||
    meta?.content_type ||
    fallback.contentType ||
    '';
  const name =
    meta?.filename ||
    meta?.meta?.name ||
    meta?.name ||
    fallback.name ||
    fileId;
  const size = meta?.meta?.size ?? meta?.size;
  const collectionName = meta?.meta?.collection_name || meta?.collection_name;
  const isImage = String(contentType).toLowerCase().startsWith('image/');

  /** @type {Record<string, unknown>} */
  const desc = {
    type: isImage ? 'image' : 'file',
    id: fileId,
    name,
    url: fileId,
  };
  if (contentType) desc.content_type = contentType;
  if (typeof size === 'number') desc.size = size;
  if (collectionName) desc.collection_name = collectionName;
  return desc;
}

/**
 * List every file the user has uploaded (used by the "#" mention picker).
 * @returns {Promise<object[]>}
 */
export async function listFiles() {
  const { FILES_LIST } = await getEndpoints();
  const response = await apiFetch(FILES_LIST, { method: 'GET' });
  if (!response.ok) throw new Error(`Failed to list files (${response.status})`);
  const data = await response.json();
  return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
}

/**
 * @param {string} fileId
 */
export async function getFileMetadata(fileId) {
  const { FILE_BY_ID } = await getEndpoints();
  const response = await apiFetch(FILE_BY_ID(fileId), { method: 'GET' });
  if (!response.ok) throw new Error(`Failed to get file metadata (${response.status})`);
  return response.json();
}

/**
 * Extract an Open WebUI file id from a URL, path, or bare id.
 * @param {string} urlOrId
 * @returns {string|null}
 */
export function extractFileId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;
  if (/^[a-f0-9-]{8,}$/i.test(trimmed) && !trimmed.includes('/')) return trimmed;
  const m = trimmed.match(/\/api\/v1\/files\/([^/?#]+)/i);
  if (m && m[1]) return decodeURIComponent(m[1]);
  return null;
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Fetch file bytes with the session JWT and return a data URL safe for content scripts.
 * (blob: URLs from the service worker are not usable in the page/content script.)
 *
 * @param {string} urlOrId Absolute OWUI URL, relative `/api/v1/files/...`, or bare file id
 * @returns {Promise<{ dataUrl: string, contentType: string, fileId: string|null }>}
 */
export async function fetchFileContentAsDataUrl(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') {
    throw new Error('Missing file url');
  }
  if (urlOrId.startsWith('data:')) {
    return { dataUrl: urlOrId, contentType: '', fileId: null };
  }

  const fileId = extractFileId(urlOrId);
  let fetchUrl = urlOrId;

  if (fileId) {
    const { FILE_CONTENT } = await getEndpoints();
    fetchUrl = FILE_CONTENT(fileId);
  } else if (urlOrId.startsWith('/')) {
    const { BASE_URL } = await getEndpoints();
    fetchUrl = `${BASE_URL.replace(/\/$/, '')}${urlOrId}`;
  }

  const response = await apiFetch(fetchUrl, { method: 'GET' });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to fetch file (${response.status}): ${text.slice(0, 120)}`);
  }

  const contentType =
    (response.headers.get('content-type') || '').split(';')[0].trim() || 'application/octet-stream';
  const buffer = await response.arrayBuffer();
  const b64 = arrayBufferToBase64(buffer);
  const dataUrl = `data:${contentType};base64,${b64}`;
  return { dataUrl, contentType, fileId };
}

/**
 * @param {string} fileId
 * @param {string} fileName
 * @param {string} [contentType]
 * @param {boolean} [isImage]
 */
export function buildFileAttachment(fileId, fileName, contentType = '', isImage = false) {
  return {
    type: isImage ? 'image' : 'file',
    id: fileId,
    name: fileName,
    url: fileId,
    content_type: contentType || undefined,
  };
}

/**
 * @param {string} fileId
 * @param {string} fileName
 * @param {string} [collectionName]
 */
export function buildKnowledgeAttachment(fileId, fileName, collectionName) {
  return {
    type: 'file',
    id: fileId,
    name: fileName,
    url: fileId,
    knowledge: true,
    collection_name: collectionName || undefined,
  };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.neuraAPIEndpoint) {
    pageContextCache.clear();
  }
});
