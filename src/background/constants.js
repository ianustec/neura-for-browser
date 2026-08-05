// Placeholder default when no server is configured in extension settings.
// Users enter their OpenWebUI/Neura backend URL in Settings after install.
export const DEFAULT_API_ENDPOINT = 'https://your-openwebui-server.example/api/chat/completions';

export function normalizeApiEndpoint(raw) {
  let url = String(raw || '').trim();
  if (!url) return DEFAULT_API_ENDPOINT;
  url = url
    .replace(/\/api\/chatm\/completition/gi, '/api/chat/completions')
    .replace(/\/api\/chat\/completition/gi, '/api/chat/completions')
    .replace(/\/api\/chatm\/completions/gi, '/api/chat/completions')
    .replace(/\/api\/chat\/completion(?=\/?($|[?#]))/gi, '/api/chat/completions');
  return url;
}

export const WS_PATH = '/ws/socket.io';

export const STORAGE_KEYS = {
  OWUI_SERVER_CONFIG: 'owuiServerConfig',
  ACTIVE_CHAT_ID: 'neuraActiveChatId',
  SIDEBAR_OPEN: 'neuraSidebarOpen',
  VISION_SCREENSHOTS: 'neuraVisionScreenshots',
};

export function buildSocketUrl(apiEndpoint) {
  const base = apiEndpoint.replace(/\/api\/chat\/completions\/?$/, '');
  return base.replace(/^http/, 'ws');
}

export async function getEndpoints() {
  const { neuraAPIEndpoint } = await chrome.storage.sync.get(['neuraAPIEndpoint']);
  const apiEndpoint = normalizeApiEndpoint(neuraAPIEndpoint);
  const baseUrl = apiEndpoint.replace(/\/api\/chat\/completions\/?$/, '');

  return {
    API_ENDPOINT: apiEndpoint,
    BASE_URL: baseUrl,
    HEALTH: `${baseUrl}/health`,
    CONFIG: `${baseUrl}/api/config`,
    SIGNIN: `${baseUrl}/api/v1/auths/signin`,
    AUTH_ME: `${baseUrl}/api/v1/auths/`,
    SIGNOUT: `${baseUrl}/api/v1/auths/signout`,
    MODELS_ENDPOINT: `${baseUrl}/api/models`,
    MODEL_DETAIL_ENDPOINT: (id) => `${baseUrl}/api/v1/models/model?id=${encodeURIComponent(id)}`,
    MODEL_PROFILE_IMAGE: (id) =>
      `${baseUrl}/api/v1/models/model/profile/image?id=${encodeURIComponent(id)}`,
    PERMISSIONS: `${baseUrl}/api/v1/users/permissions`,
    TOOLS: `${baseUrl}/api/v1/tools/`,
    NEW_CHAT_ENDPOINT: `${baseUrl}/api/v1/chats/new`,
    CHATS_LIST: `${baseUrl}/api/v1/chats/`,
    CHATS_PINNED: `${baseUrl}/api/v1/chats/pinned`,
    CHATS_ARCHIVED: `${baseUrl}/api/v1/chats/archived`,
    CHAT_BY_ID: (id) => `${baseUrl}/api/v1/chats/${id}`,
    CHAT_PIN: (id) => `${baseUrl}/api/v1/chats/${id}/pin`,
    CHAT_ARCHIVE: (id) => `${baseUrl}/api/v1/chats/${id}/archive`,
    CHAT_SEARCH: `${baseUrl}/api/v1/chats/search`,
    CHAT_TAGS: (id) => `${baseUrl}/api/v1/chats/${id}/tags`,
    ALL_TAGS: `${baseUrl}/api/v1/chats/all/tags`,
    CHAT_DELETE_MESSAGE: (chatId, messageId) =>
      `${baseUrl}/api/v1/chats/${chatId}/messages/${messageId}`,
    CHAT_SHARE: (id) => `${baseUrl}/api/v1/chats/${id}/share`,
    CHAT_CLONE: (id) => `${baseUrl}/api/v1/chats/${id}/clone`,
    FOLDERS: `${baseUrl}/api/v1/folders/`,
    FOLDER_BY_ID: (id) => `${baseUrl}/api/v1/folders/${id}`,
    FOLDER_UPDATE: (id) => `${baseUrl}/api/v1/folders/${id}/update`,
    FOLDER_UPDATE_PARENT: (id) => `${baseUrl}/api/v1/folders/${id}/update/parent`,
    FOLDER_UPDATE_NAME: (id) => `${baseUrl}/api/v1/folders/${id}/update`,
    CHATS_BY_FOLDER: (id) => `${baseUrl}/api/v1/chats/folder/${id}`,
    CHAT_MOVE_FOLDER: (id) => `${baseUrl}/api/v1/chats/${id}/folder`,
    // Chat attachments (Conduit-aligned): no process query.
    FILES_UPLOAD: `${baseUrl}/api/v1/files/`,
    // Knowledge-base workspace uploads that need immediate OCR/indexing.
    FILES_UPLOAD_PROCESS: `${baseUrl}/api/v1/files/?process=true&process_in_background=false`,
    FILES_LIST: `${baseUrl}/api/v1/files/`,
    FILE_BY_ID: (id) => `${baseUrl}/api/v1/files/${id}`,
    FILE_CONTENT: (id) => `${baseUrl}/api/v1/files/${id}/content`,
    IMAGES_GENERATIONS: `${baseUrl}/api/v1/images/generations`,
    IMAGES_EDIT: `${baseUrl}/api/v1/images/edit`,
    KNOWLEDGE_LIST: `${baseUrl}/api/v1/knowledge/`,
    KNOWLEDGE_FILES: (id) => `${baseUrl}/api/v1/knowledge/${id}/files`,
    KNOWLEDGE_SEARCH: `${baseUrl}/api/v1/knowledge/search`,
    KNOWLEDGE_SEARCH_FILES: `${baseUrl}/api/v1/knowledge/search/files`,
    RETRIEVAL_WEB: `${baseUrl}/api/v1/retrieval/process/web`,
    RETRIEVAL_YOUTUBE: `${baseUrl}/api/v1/retrieval/process/youtube`,
    AUDIO_TRANSCRIPTIONS: `${baseUrl}/api/v1/audio/transcriptions`,
    AUDIO_SPEECH: `${baseUrl}/api/v1/audio/speech`,
    AUDIO_VOICES: `${baseUrl}/api/v1/audio/voices`,
    AUDIO_MODELS: `${baseUrl}/api/v1/audio/models`,
    NOTES: `${baseUrl}/api/v1/notes/`,
    NOTES_SEARCH: `${baseUrl}/api/v1/notes/search`,
    NOTES_CREATE: `${baseUrl}/api/v1/notes/create`,
    NOTE_BY_ID: (id) => `${baseUrl}/api/v1/notes/${id}`,
    NOTE_UPDATE: (id) => `${baseUrl}/api/v1/notes/${id}/update`,
    NOTE_DELETE: (id) => `${baseUrl}/api/v1/notes/${id}/delete`,
    PROMPTS: `${baseUrl}/api/v1/prompts/`,
    PROMPTS_LIST: `${baseUrl}/api/v1/prompts/list`,
    PROMPTS_CREATE: `${baseUrl}/api/v1/prompts/create`,
    PROMPT_BY_COMMAND: (cmd) =>
      `${baseUrl}/api/v1/prompts/command/${encodeURIComponent(String(cmd || '').replace(/^\//, ''))}`,
    PROMPT_DELETE: (id) =>
      `${baseUrl}/api/v1/prompts/id/${encodeURIComponent(String(id || ''))}/delete`,
    CHAT_COMPLETED_ENDPOINT: `${baseUrl}/api/chat/completed`,
    TASK_STOP: (taskId) => `${baseUrl}/api/tasks/stop/${encodeURIComponent(taskId)}`,
    TASK_CHAT_STOP: (chatId) => `${baseUrl}/api/tasks/chat/${encodeURIComponent(chatId)}/stop`,
    TASK_CHAT_LIST: (chatId) => `${baseUrl}/api/tasks/chat/${encodeURIComponent(chatId)}`,
    WS_URL: buildSocketUrl(apiEndpoint),
  };
}
