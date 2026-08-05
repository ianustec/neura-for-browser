/**
 * Abort controllers for in-flight turns, scoped per tab.
 *
 * One controller per tab, not one per extension: two tabs can legitimately be
 * generating at the same time and must not cancel each other. Aborting the
 * signal is all that is needed — the socket consumer reacts to it by asking Open
 * WebUI to stop the chat's tasks and then waits for the server to confirm
 * (see owui-turn-channel.js).
 */

/** @type {Map<string, AbortController>} */
const controllers = new Map();

/**
 * @param {number|null|undefined} tabId
 * @returns {string}
 */
function keyFor(tabId) {
  return tabId == null ? 'detached' : `tab:${tabId}`;
}

/**
 * Replace the controller for a tab, aborting whatever it was running before: a
 * new turn on a tab supersedes the previous one.
 * @param {number|null} [tabId]
 * @returns {AbortController}
 */
export function newAbortController(tabId = null) {
  const key = keyFor(tabId);
  const previous = controllers.get(key);
  if (previous && !previous.signal.aborted) {
    previous.abort();
  }
  const controller = new AbortController();
  controllers.set(key, controller);
  return controller;
}

/**
 * @param {number|null} [tabId]
 * @returns {Promise<boolean>} whether something was actually running
 */
export async function abortStreaming(tabId = null) {
  const key = keyFor(tabId);
  const controller = controllers.get(key);
  if (!controller) return false;
  controllers.delete(key);
  if (controller.signal.aborted) return false;
  controller.abort();
  return true;
}

/**
 * Drop a finished controller so it cannot be aborted later by an unrelated turn.
 * @param {number|null} tabId
 * @param {AbortController} controller
 */
export function releaseAbortController(tabId, controller) {
  const key = keyFor(tabId);
  if (controllers.get(key) === controller) {
    controllers.delete(key);
  }
}
