/**
 * Open WebUI task registry client.
 *
 * The server registers one task per (chat_id, assistant message) whenever a
 * completion is requested with both `session_id` and `chat_id`. That registry —
 * not any client-side timer — is the authoritative answer to "is generation for
 * this chat still running?".
 *
 * Endpoints (mounted directly on /api, not /api/v1):
 * - GET  /api/tasks/chat/{chat_id}        -> { task_ids: [...] }   (verified user)
 * - POST /api/tasks/chat/{chat_id}/stop   -> { status, message }   (verified user)
 * - POST /api/tasks/stop/{task_id}        -> { status, message }   (admin only since 0.9.0)
 */
import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';
import { getServerCapabilities } from './openwebui-config.js';
import { dlog, dwarn } from './debug-log.js';

/**
 * Ask the server which tasks are still running for a chat.
 *
 * Returns `null` when the answer is indeterminate (network error, non-2xx,
 * malformed body). Callers must never treat `null` as "finished": an empty list
 * is a statement by the server, an error is not.
 *
 * @param {string} chatId
 * @returns {Promise<string[] | null>}
 */
export async function listChatTaskIds(chatId) {
  const id = String(chatId || '').trim();
  if (!id) return null;
  try {
    const { TASK_CHAT_LIST } = await getEndpoints();
    const res = await apiFetch(TASK_CHAT_LIST(id), { method: 'GET' });
    if (!res.ok) {
      dwarn('owui-tasks', 'task list request failed', { chatId: id, status: res.status });
      return null;
    }
    const json = await res.json().catch(() => null);
    if (!json || !Array.isArray(json.task_ids)) {
      dwarn('owui-tasks', 'task list response malformed', { chatId: id });
      return null;
    }
    return json.task_ids.map((t) => String(t));
  } catch (e) {
    dwarn('owui-tasks', 'task list threw', { chatId: id, error: String(e?.message || e) });
    return null;
  }
}

/**
 * @param {string} taskId
 * @returns {Promise<boolean>}
 */
async function stopSingleTask(taskId) {
  const id = String(taskId || '').trim();
  if (!id) return false;
  try {
    const { TASK_STOP } = await getEndpoints();
    const res = await apiFetch(TASK_STOP(id), { method: 'POST' });
    if (!res.ok) {
      dwarn('owui-tasks', 'per-task stop failed', { taskId: id, status: res.status });
      return false;
    }
    return true;
  } catch (e) {
    dwarn('owui-tasks', 'per-task stop threw', { taskId: id, error: String(e?.message || e) });
    return false;
  }
}

/**
 * Cancel every running task of a chat.
 *
 * Prefers the chat-scoped endpoint, which is the only one a non-admin user may
 * call on Open WebUI >= 0.9.0. Falls back to per-task stop when the server
 * rejects it (older server without the route) or when no chat id is available.
 *
 * @param {object} opts
 * @param {string} [opts.chatId]
 * @param {string[]} [opts.taskIds]
 * @returns {Promise<boolean>} whether the server accepted a cancel request
 */
export async function stopChatTasks({ chatId = '', taskIds = [] } = {}) {
  const id = String(chatId || '').trim();
  const ids = (Array.isArray(taskIds) ? taskIds : []).map((t) => String(t || '').trim()).filter(Boolean);

  if (id) {
    const caps = await getServerCapabilities();
    if (caps.chatScopedTaskStop !== false) {
      try {
        const { TASK_CHAT_STOP } = await getEndpoints();
        const res = await apiFetch(TASK_CHAT_STOP(id), { method: 'POST' });
        if (res.ok) {
          dlog('owui-tasks', 'chat-scoped stop accepted', { chatId: id });
          return true;
        }
        dwarn('owui-tasks', 'chat-scoped stop rejected; falling back to per-task stop', {
          chatId: id,
          status: res.status,
        });
      } catch (e) {
        dwarn('owui-tasks', 'chat-scoped stop threw; falling back to per-task stop', {
          chatId: id,
          error: String(e?.message || e),
        });
      }
    }
  }

  if (ids.length === 0) return false;
  const results = await Promise.all(ids.map((taskId) => stopSingleTask(taskId)));
  return results.some(Boolean);
}
