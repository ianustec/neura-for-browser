import { handleConnect, handleRuntimeMessage } from './router.js';
import * as turnState from './turn-state.js';
import { recoverTurnsAfterRestart } from './turn-recovery.js';
import { migrateLegacyApiKey, purgeLegacyStoredCredentials } from './auth.js';
import * as socketService from './socket-service.js';
import { setAgentAborted } from './agent/agent-abort.js';
import { cleanupLegacyToolSelectionStorage } from './session-overrides.js';
import { invalidateModelMetadataCache } from './model-metadata.js';
import * as outbox from './outbox.js';
import { syncChatsBidirectional } from './chat-sync.js';

const SOCKET_KEEPALIVE_ALARM = 'socket-keepalive';
const OUTBOX_DRAIN_ALARM = 'chat-outbox-drain';
const CHAT_SYNC_ALARM = 'chat-bidirectional-sync';
/** Chrome 120+ allows periodInMinutes as low as 0.5 (30 seconds). */
const CHAT_SYNC_PERIOD_MINUTES = 0.5;

let chatSyncRunning = false;

function broadcastToTabs(message) {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs || []) {
        if (!tab?.id) continue;
        try {
          chrome.tabs.sendMessage(tab.id, message, () => {
            void chrome.runtime.lastError;
          });
        } catch (e) {
          /* ignore */
        }
      }
    });
  } catch (e) {
    /* ignore */
  }
}

async function runChatSync() {
  if (chatSyncRunning) return;
  chatSyncRunning = true;
  try {
    const result = await syncChatsBidirectional();
    if (result?.ok) {
      // Refresh sidebar so remote-only chats / dates stay current.
      broadcastToTabs({ action: 'chats_synced', ...result });
    }
  } catch (e) {
    console.warn('[Neura] periodic chat sync failed', e);
  } finally {
    chatSyncRunning = false;
  }
}

function onExtensionReady() {
  invalidateModelMetadataCache();
  migrateLegacyApiKey().catch(() => {});
  purgeLegacyStoredCredentials().catch((err) => {
    console.warn('Neura: legacy credential purge on startup failed', err);
  });
  cleanupLegacyToolSelectionStorage().catch(() => {});
  turnState.pruneOldTurns().catch(() => {});
  // Reconnect first: recovery re-subscribes to turns the server may still be
  // running, and that needs a live socket.
  socketService
    .connect()
    .catch((e) => console.warn('Neura: socket connect on ready failed', e))
    .finally(() => {
      recoverTurnsAfterRestart().catch((e) =>
        console.warn('Neura: turn recovery after restart failed', e),
      );
    });
  chrome.alarms.create(SOCKET_KEEPALIVE_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(OUTBOX_DRAIN_ALARM, { periodInMinutes: 2 });
  chrome.alarms.create(CHAT_SYNC_ALARM, { periodInMinutes: CHAT_SYNC_PERIOD_MINUTES });
  outbox.drainQueue().catch((e) => console.warn('Neura: initial outbox drain failed', e));
  runChatSync().catch(() => {});
}

outbox.installDrainTriggers(OUTBOX_DRAIN_ALARM);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SOCKET_KEEPALIVE_ALARM) {
    socketService.ensureConnectedIfAuthenticated().catch(() => {});
  }
  if (alarm.name === CHAT_SYNC_ALARM) {
    runChatSync().catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Neura Assistant: install — accedi con le tue credenziali Open WebUI nelle impostazioni.');
  }
  onExtensionReady();
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(onExtensionReady);
}

chrome.runtime.onConnect.addListener(handleConnect);
chrome.runtime.onMessage.addListener(handleRuntimeMessage);

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    const turn = turnState.getActiveTurnForTab(tabId);
    if (turn && turn.phase !== 'navigating') {
      turnState.setPhase(turn, 'navigating', { targetUrl: info.url || null });
    }
  }
  if (info.status === 'complete') {
    const turn = turnState.getActiveTurnForTab(tabId);
    if (turn?.phase === 'navigating') {
      turnState.setPhase(turn, 'streaming');
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const turn = turnState.getTurn(tabId);
  if (turn) {
    setAgentAborted(true);
    turnState.endTurn(turn, 'aborted');
    turnState.dropTurn(tabId);
  }
});

onExtensionReady();
