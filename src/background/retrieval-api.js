import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';
import { enrichFileAttachment, uploadTextContentAsFile } from './files-api.js';
import { dlog } from './debug-log.js';

/**
 * @param {string} url
 * @param {string} [collectionName]
 */
export async function ingestWebPage(url, collectionName) {
  const { RETRIEVAL_WEB } = await getEndpoints();
  const body = { url };
  if (collectionName) body.collection_name = collectionName;

  const response = await apiFetch(RETRIEVAL_WEB, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Web ingestion failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * @param {string} url
 * @param {string} [collectionName]
 */
export async function ingestYouTube(url, collectionName) {
  const { RETRIEVAL_YOUTUBE } = await getEndpoints();
  const body = { url };
  if (collectionName) body.collection_name = collectionName;

  const response = await apiFetch(RETRIEVAL_YOUTUBE, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`YouTube ingestion failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isYouTubeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtu.be' ||
      host.endsWith('.youtube.com')
    );
  } catch {
    return /youtube\.com|youtu\.be/i.test(String(url || ''));
  }
}

/**
 * Pull a usable OWUI file id from an ingest response (shape varies by version).
 * @param {object} ingestResponse
 * @returns {string|null}
 */
function extractIngestFileId(ingestResponse) {
  if (!ingestResponse || typeof ingestResponse !== 'object') return null;
  const candidates = [
    ingestResponse.id,
    ingestResponse.file_id,
    ingestResponse.fileId,
    ingestResponse.file?.id,
    ingestResponse.file?.file_id,
    ingestResponse.data?.id,
    ingestResponse.data?.file_id,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return null;
}

/**
 * @param {object} ingestResponse
 * @returns {string}
 */
function extractIngestContent(ingestResponse) {
  const file = ingestResponse?.file || {};
  const content =
    file?.data?.content ??
    ingestResponse?.content ??
    ingestResponse?.text ??
    '';
  return typeof content === 'string' ? content : String(content || '');
}

/**
 * Build an OWUI `type:file` attachment from web/YouTube ingest.
 * Prefer the server file id; otherwise upload the returned text content.
 * @param {object} ingestResponse
 * @param {string} url
 * @param {{ youtube?: boolean, displayName?: string }} [opts]
 * @returns {Promise<object>}
 */
export async function buildWebContextAttachment(ingestResponse, url, opts = {}) {
  const displayName =
    opts.displayName ||
    ingestResponse?.file?.meta?.name ||
    ingestResponse?.name ||
    url;
  const collectionName =
    ingestResponse?.collection_name ||
    ingestResponse?.file?.meta?.collection_name ||
    null;

  const fileId = extractIngestFileId(ingestResponse);
  dlog('retrieval', 'buildWebContextAttachment', {
    url,
    youtube: !!opts.youtube,
    displayName,
    ingestFileId: fileId,
    keys: ingestResponse && typeof ingestResponse === 'object' ? Object.keys(ingestResponse) : [],
  });
  if (fileId) {
    const attachment = await enrichFileAttachment(fileId, {
      name: displayName,
      contentType: 'text/plain',
    });
    attachment.sourceUrl = url;
    attachment.meta = { ...(attachment.meta || {}), source: url };
    if (collectionName) attachment.collection_name = collectionName;
    if (opts.youtube) attachment.context = 'full';
    else attachment.context = 'page';
    if (displayName) attachment.name = displayName;
    dlog('retrieval', 'using ingest file id', { fileId, context: attachment.context });
    return attachment;
  }

  const contentStr = extractIngestContent(ingestResponse);
  if (!contentStr.trim()) {
    throw new Error('Web/YouTube ingestion returned empty content');
  }

  dlog('retrieval', 'no ingest file id; uploading content as OWUI file', {
    url,
    chars: contentStr.length,
  });
  const attachment = await uploadTextContentAsFile(contentStr, {
    name: displayName,
    sourceUrl: url,
  });
  if (collectionName) attachment.collection_name = collectionName;
  if (opts.youtube) attachment.context = 'full';
  else attachment.context = 'page';
  if (displayName) attachment.name = displayName;
  dlog('retrieval', 'uploaded fallback file', { fileId: attachment.id, context: attachment.context });
  return attachment;
}

/**
 * Ingest a URL as web page or YouTube transcript → OWUI file attachment.
 * @param {string} url
 * @param {{ displayName?: string }} [opts]
 * @returns {Promise<object>}
 */
export async function ingestUrlAsContextAttachment(url, opts = {}) {
  const trimmed = String(url || '').trim();
  if (!trimmed) throw new Error('Missing URL to ingest');
  const youtube = isYouTubeUrl(trimmed);
  const raw = youtube ? await ingestYouTube(trimmed) : await ingestWebPage(trimmed);
  return buildWebContextAttachment(raw, trimmed, {
    youtube,
    displayName: opts.displayName,
  });
}

/**
 * @param {unknown} data
 * @returns {unknown[]}
 */
function extractItems(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.items)) return data.items;
  if (data && typeof data === 'object' && Array.isArray(data.data)) return data.data;
  return [];
}

export async function listKnowledgeBases() {
  const { KNOWLEDGE_LIST } = await getEndpoints();
  const response = await apiFetch(KNOWLEDGE_LIST, { method: 'GET' });
  if (!response.ok) throw new Error(`Failed to list knowledge bases (${response.status})`);
  const data = await response.json();
  return extractItems(data);
}

/**
 * @param {string} kbId
 * @param {number} [page]
 */
export async function listKnowledgeFiles(kbId, page = 1) {
  const { KNOWLEDGE_FILES } = await getEndpoints();
  const response = await apiFetch(`${KNOWLEDGE_FILES(kbId)}?page=${page}`, { method: 'GET' });
  if (!response.ok) throw new Error(`Failed to list knowledge files (${response.status})`);
  return response.json();
}

/**
 * Searches knowledge bases accessible to the current user, mirroring the
 * "#" mention picker used by the Open WebUI webapp and by Conduit
 * (`api.searchKnowledgeBases()` in `conduit/lib/core/services/api_service.dart`).
 * @param {string} [query]
 * @returns {Promise<object[]>}
 */
export async function searchKnowledgeBases(query = '') {
  const { KNOWLEDGE_SEARCH } = await getEndpoints();
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  const url = params.toString() ? `${KNOWLEDGE_SEARCH}?${params}` : KNOWLEDGE_SEARCH;
  const response = await apiFetch(url, { method: 'GET' });
  if (!response.ok) throw new Error(`Failed to search knowledge bases (${response.status})`);
  const data = await response.json();
  return extractItems(data);
}

/**
 * Searches files that belong to any knowledge base accessible to the
 * current user (not the user's personal file uploads). Each item includes
 * a `collection` object identifying the parent knowledge base, mirroring
 * `api.searchKnowledgeFiles()` in Conduit and `searchKnowledgeFiles()` in
 * the Open WebUI webapp (`src/lib/apis/knowledge/index.ts`).
 * @param {string} [query]
 * @returns {Promise<object[]>}
 */
export async function searchKnowledgeFiles(query = '') {
  const { KNOWLEDGE_SEARCH_FILES } = await getEndpoints();
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  const url = params.toString() ? `${KNOWLEDGE_SEARCH_FILES}?${params}` : KNOWLEDGE_SEARCH_FILES;
  const response = await apiFetch(url, { method: 'GET' });
  if (!response.ok) throw new Error(`Failed to search knowledge files (${response.status})`);
  const data = await response.json();
  return extractItems(data);
}
