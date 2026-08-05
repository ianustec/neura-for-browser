/**
 * Open WebUI chat id conventions (mirrors the server's utils/chat_id.py).
 *
 * A `temporary:` chat is not persisted server-side, yet still gets task
 * registration, `chat:active` events and chat-scoped cancellation. The suffix is
 * read by the server as the caller's live Socket.IO session id and used for the
 * ownership check on /api/tasks/chat/{chat_id}, so it must be a real sid — an
 * arbitrary uuid makes those endpoints answer "not yours" for non-admin users.
 *
 * `local:` is the legacy spelling the server still accepts; we only produce the
 * canonical `temporary:` form.
 */
const TEMPORARY_CHAT_ID_PREFIX = 'temporary:';
const LEGACY_TEMPORARY_CHAT_ID_PREFIX = 'local:';
const CHANNEL_CHAT_ID_PREFIX = 'channel:';

const NON_SAVED_PREFIXES = [
  TEMPORARY_CHAT_ID_PREFIX,
  LEGACY_TEMPORARY_CHAT_ID_PREFIX,
  CHANNEL_CHAT_ID_PREFIX,
];

/**
 * @param {string | null | undefined} sessionId live socket session id
 * @returns {string | null} null when there is no session to bind the chat to
 */
export function createTemporaryChatId(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  return `${TEMPORARY_CHAT_ID_PREFIX}${sid}`;
}

/**
 * @param {string | null | undefined} chatId
 * @returns {boolean}
 */
export function isTemporaryChatId(chatId) {
  const id = String(chatId || '');
  return (
    id.startsWith(TEMPORARY_CHAT_ID_PREFIX) || id.startsWith(LEGACY_TEMPORARY_CHAT_ID_PREFIX)
  );
}

/**
 * A "saved" chat id is one the server expects to find a row for, and for which
 * it persists messages, title and tags by itself.
 * @param {string | null | undefined} chatId
 * @returns {boolean}
 */
export function isSavedChatId(chatId) {
  const id = String(chatId || '').trim();
  if (!id) return false;
  return !NON_SAVED_PREFIXES.some((prefix) => id.startsWith(prefix));
}
