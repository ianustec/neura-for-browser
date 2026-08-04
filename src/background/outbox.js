/**
 * Offline-resilience outbox for chat sync writes (Conduit-style, simplified).
 *
 * The extension is online-first: pushTurnToServer() normally writes directly
 * to Open WebUI right after a turn completes. If that write fails (network
 * down, server temporarily unreachable, ...) the operation is queued here
 * instead of being silently dropped, and retried with backoff whenever
 * connectivity is likely restored (online event, periodic alarm, or the next
 * time the user sends a message). Local chat history (chrome.storage.local,
 * see chat-sync.js/local-chats.js) is always up to date regardless — this
 * queue only concerns the *remote* Open WebUI mirror of the conversation.
 *
 * chat-sync.js imports this module for enqueue-on-failure; we import its
 * retry helpers here. Safe with ES modules because both sides only call
 * across the cycle from inside functions (never at module top level).
 * Dynamic import() is disallowed in ServiceWorkerGlobalScope.
 */

import { retryPushTurnToServer, retryPushFullChatBlob } from './chat-sync.js';

const OUTBOX_KEY = 'neuraChatOutbox';
const MAX_ATTEMPTS = 8;
// Capped exponential backoff: 15s, 30s, 60s, ... up to 20 minutes.
const BASE_DELAY_MS = 15_000;
const MAX_DELAY_MS = 20 * 60 * 1000;

let draining = false;

/**
 * @returns {Promise<object[]>}
 */
async function readQueue() {
  const { [OUTBOX_KEY]: queue } = await chrome.storage.local.get([OUTBOX_KEY]);
  return Array.isArray(queue) ? queue : [];
}

/**
 * @param {object[]} queue
 */
async function writeQueue(queue) {
  await chrome.storage.local.set({ [OUTBOX_KEY]: queue });
}

function makeOpId() {
  return globalThis.crypto?.randomUUID?.() || `outbox_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * @param {number} attempts
 * @returns {number}
 */
function nextDelayMs(attempts) {
  const delay = BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

/**
 * Queues a "push turn to server" operation for later retry.
 * @param {'pushTurn'|'pushFullBlob'} type
 * @param {object} payload — passed verbatim to the matching chat-sync function on retry.
 * @returns {Promise<void>}
 */
export async function enqueue(type, payload) {
  const queue = await readQueue();
  // A newer push for the same local chat supersedes any older queued one —
  // it already carries the full up-to-date message list.
  const filtered = queue.filter((op) => op.payload?.localChatId !== payload?.localChatId);
  filtered.push({
    id: makeOpId(),
    type,
    payload,
    attempts: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });
  await writeQueue(filtered);
}

/**
 * @returns {Promise<number>} number of operations currently queued
 */
export async function size() {
  return (await readQueue()).length;
}

/**
 * Attempts to flush every due operation in the outbox. Safe to call
 * frequently/concurrently — re-entrant calls are ignored while one drain is
 * already in progress.
 * @returns {Promise<void>}
 */
export async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    let queue = await readQueue();
    if (queue.length === 0) return;

    const now = Date.now();
    const remaining = [];
    for (const op of queue) {
      if ((op.nextAttemptAt || 0) > now) {
        remaining.push(op);
        continue;
      }
      try {
        if (op.type === 'pushTurn') {
          await retryPushTurnToServer(op.payload);
        } else if (op.type === 'pushFullBlob') {
          await retryPushFullChatBlob(op.payload);
        }
        // Success: drop from the queue.
      } catch (e) {
        const attempts = (op.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          console.warn('[Neura] outbox: giving up on operation after max attempts', op.type, e);
          // Drop after exhausting retries — the local copy of the chat is
          // still intact; the user can force a re-sync from the chat menu.
        } else {
          remaining.push({
            ...op,
            attempts,
            nextAttemptAt: now + nextDelayMs(attempts),
          });
        }
      }
    }
    await writeQueue(remaining);
  } catch (e) {
    console.warn('[Neura] outbox: drainQueue failed', e);
  } finally {
    draining = false;
  }
}

/**
 * Wires alarm-based periodic draining and the online event (best-effort —
 * service workers can be suspended, so the alarm is the reliable path).
 * @param {string} alarmName
 */
export function installDrainTriggers(alarmName) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === alarmName) drainQueue().catch(() => {});
  });
  try {
    self.addEventListener('online', () => drainQueue().catch(() => {}));
  } catch (e) {
    /* not available in this context; alarm still covers it */
  }
}
