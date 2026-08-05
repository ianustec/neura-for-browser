/**
 * Recovery of turns that were still running when the service worker was killed.
 *
 * A restart of the worker does not stop Open WebUI: the task keeps running and
 * keeps emitting events to the user's room. The task registry is therefore the
 * only correct way to decide what happened, exactly as the web client does after
 * a reconnect (it re-reads `GET /api/tasks/chat/{chat_id}` and rejoins).
 */
import * as turnState from './turn-state.js';
import { listChatTaskIds } from './owui-tasks.js';
import { isTemporaryChatId } from './owui-chat-id.js';
import { beginTurn as beginChannelTurn } from './owui-turn-channel.js';
import { getToken } from './auth.js';
import { dlog, dwarn } from './debug-log.js';

/**
 * Re-subscribe to a turn the server is still working on. Content arrives in the
 * turn's event buffer and is drained when the page rejoins the streaming port.
 * @param {object} snap
 * @param {string[]} taskIds
 */
function resumeTurn(snap, taskIds) {
  const turn = turnState.rehydrateTurn(snap);
  const consumer = beginChannelTurn({
    messageId: snap.assistantMessageId,
    chatId: snap.owuiChatId,
    broadcast: (ev) => turnState.broadcast(turn, ev),
    onPartial: () => {},
  });
  consumer.attachTaskIds(taskIds);

  consumer.promise
    .then((result) => {
      const finalText = result?.fullContent || turn.partialContent || '';
      turnState.endTurn(turn, 'done', { finalText });
      turnState.broadcast(turn, {
        type: 'done',
        content: finalText,
        reasoning: result?.fullReasoning || '',
        outputItems: result?.outputItems || [],
      });
    })
    .catch((err) => {
      if (err?.name === 'AbortError') {
        turnState.endTurn(turn, 'aborted', { finalText: turn.partialContent || '' });
        turnState.broadcast(turn, { type: 'aborted', content: turn.partialContent || '' });
        return;
      }
      turnState.endTurn(turn, 'error');
      turnState.broadcast(turn, { type: 'error', error: String(err?.message || err) });
    });
}

/**
 * Decide the fate of every turn that had not ended, then clean up storage.
 * @returns {Promise<void>}
 */
export async function recoverTurnsAfterRestart() {
  await turnState.pruneInvalidTurns();

  const snapshots = await turnState.readUnfinishedSnapshots();
  if (snapshots.length === 0) return;

  const token = await getToken();
  for (const snap of snapshots) {
    const owuiChatId = snap.owuiChatId || '';

    if (!token || !owuiChatId || !snap.assistantMessageId) {
      // Nothing to ask the server about: the turn never reached the async path.
      await turnState.markSnapshotEnded(snap, 'aborted', 'sw_restart');
      continue;
    }

    if (isTemporaryChatId(owuiChatId)) {
      // A temporary chat is bound to the socket session that created it; the
      // restart replaced that session, so neither the registry nor a cancel can
      // address it any more.
      dwarn('turn-recovery', 'temporary chat cannot be recovered after restart', {
        chatId: owuiChatId,
      });
      await turnState.markSnapshotEnded(snap, 'aborted', 'sw_restart_temporary');
      continue;
    }

    const running = await listChatTaskIds(owuiChatId);
    if (running === null) {
      dwarn('turn-recovery', 'task registry unavailable; leaving turn for the next attempt', {
        chatId: owuiChatId,
      });
      continue;
    }

    const ours = Array.isArray(snap.taskIds) ? snap.taskIds.filter(Boolean) : [];
    const stillRunning = ours.length > 0 ? ours.filter((id) => running.includes(id)) : running;

    if (stillRunning.length > 0) {
      dlog('turn-recovery', 'resuming turn still running on the server', {
        chatId: owuiChatId,
        messageId: snap.assistantMessageId,
      });
      resumeTurn(snap, stillRunning);
      continue;
    }

    // The server finished while we were down; it persisted the message itself,
    // so the chat picks it up on its next load.
    dlog('turn-recovery', 'turn completed while the worker was down', { chatId: owuiChatId });
    await turnState.markSnapshotEnded(snap, 'done', 'completed_while_down');
  }
}
