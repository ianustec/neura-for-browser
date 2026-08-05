import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.notes)) return data.notes;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export function extractNoteMarkdown(note) {
  if (!note) return '';
  const content = note.data?.content;
  if (typeof content === 'string') return content;
  if (content && typeof content.md === 'string') return content.md;
  if (content && typeof content.html === 'string') return content.html;
  return '';
}

function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id || null,
    title: raw.title || 'Untitled',
    markdown: extractNoteMarkdown(raw),
    updatedAt: raw.updated_at || raw.created_at || 0,
    createdAt: raw.created_at || 0,
    raw,
  };
}

export async function listNotes(page = 1) {
  try {
    const { NOTES } = await getEndpoints();
    const response = await apiFetch(`${NOTES}?page=${page}`, { method: 'GET' });
    if (!response.ok) {
      console.warn('[Neura] listNotes failed', response.status);
      return [];
    }
    const data = await response.json();
    return asArray(data).map(normalizeNote).filter(Boolean);
  } catch (e) {
    console.warn('[Neura] listNotes error', e);
    return [];
  }
}

export async function searchNotes(query = '', page = 1) {
  try {
    const q = String(query || '').trim();
    const { NOTES_SEARCH } = await getEndpoints();
    const params = new URLSearchParams();
    if (q) params.set('query', q);
    params.set('page', String(page));
    const response = await apiFetch(`${NOTES_SEARCH}?${params.toString()}`, { method: 'GET' });
    if (!response.ok) {
      console.warn('[Neura] searchNotes failed', response.status);
      return [];
    }
    const data = await response.json();
    return asArray(data).map(normalizeNote).filter(Boolean);
  } catch (e) {
    console.warn('[Neura] searchNotes error', e);
    return [];
  }
}

export async function getNote(id) {
  try {
    if (!id) return null;
    const { NOTE_BY_ID } = await getEndpoints();
    const response = await apiFetch(NOTE_BY_ID(id), { method: 'GET' });
    if (!response.ok) {
      console.warn('[Neura] getNote failed', response.status);
      return null;
    }
    return normalizeNote(await response.json());
  } catch (e) {
    console.warn('[Neura] getNote error', e);
    return null;
  }
}

export async function createNote({ title = 'Untitled', markdown = '' } = {}) {
  try {
    const { NOTES_CREATE } = await getEndpoints();
    const body = {
      title: String(title || 'Untitled').trim() || 'Untitled',
      data: { content: { md: String(markdown || '') } },
    };
    const response = await apiFetch(NOTES_CREATE, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Create note failed (${response.status}): ${text.slice(0, 200)}`);
    }
    return normalizeNote(await response.json());
  } catch (e) {
    console.warn('[Neura] createNote error', e);
    throw e;
  }
}

export async function updateNote(id, { title, markdown } = {}) {
  try {
    if (!id) throw new Error('Missing note id');
    const { NOTE_UPDATE } = await getEndpoints();
    const body = {};
    if (title != null) body.title = String(title).trim() || 'Untitled';
    if (markdown != null) body.data = { content: { md: String(markdown) } };
    const response = await apiFetch(NOTE_UPDATE(id), {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Update note failed (${response.status}): ${text.slice(0, 200)}`);
    }
    return normalizeNote(await response.json());
  } catch (e) {
    console.warn('[Neura] updateNote error', e);
    throw e;
  }
}

export async function deleteNote(id) {
  try {
    if (!id) return false;
    const { NOTE_DELETE } = await getEndpoints();
    const response = await apiFetch(NOTE_DELETE(id), { method: 'DELETE' });
    if (!response.ok) {
      console.warn('[Neura] deleteNote failed', response.status);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[Neura] deleteNote error', e);
    return false;
  }
}
