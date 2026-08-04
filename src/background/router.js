import { sendMessageToOpenWebUI, fetchAvailableModels } from './api.js';
import { abortStreaming } from './stream-controller.js';
import { setAgentAborted } from './agent/agent-abort.js';
import { resolveAgentConfirm, clearAllAgentConfirms } from './agent/agent-confirm.js';
import * as turnState from './turn-state.js';
import { signIn, signOut, getAuthStatus, getCurrentUser } from './auth.js';
import * as socketService from './socket-service.js';
import { probeServerFromEndpoint, getCachedServerConfig } from './openwebui-config.js';
import { getOwUiBranding } from './branding.js';
import { getModelProfileImage } from './model-icons.js';
import { getAvailableFeatures } from './permissions.js';
import {
  fetchToolsList,
  getSelectedToolsForModel,
  mergeToolsForPicker,
  setSelectedToolsForModel,
} from './tools-registry.js';
import {
  fetchModelDetailPayload,
  getModelKnowledge,
  getModelToolIds,
} from './model-metadata.js';
import {
  resolveEffectiveKnowledge,
  setKnowledgeSelection,
  resetAllOverrides,
} from './session-overrides.js';
import { extractDefaultFeatures } from './chat-payload.js';
import { searchKnowledgeBases, searchKnowledgeFiles, ingestUrlAsContextAttachment } from './retrieval-api.js';
import {
  fetchFileContentAsDataUrl,
  uploadFile,
  enrichFileAttachment,
  uploadPageContextAsFile,
} from './files-api.js';
import {
  listUnifiedChats,
  pullAndMergeLocalChat,
  importRemoteChat,
  deleteRemoteChat,
  deleteAllChats,
  pushFullChatBlob,
  readLocalChat,
  writeLocalChat,
  resolveRemoteId,
  createChatInFolder,
  setLocalChatFolder,
} from './chat-sync.js';
import * as syncStore from './chat-sync-store.js';
import * as chatsApi from './chats-api.js';
import * as promptsApi from './prompts-api.js';
import * as notesApi from './notes-api.js';
import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';
import {
  transcribeAudio,
  base64ToBlob,
  listVoices,
  synthesizeSpeech,
} from './audio-api.js';
import {
  sendToOffscreen,
  handleOffscreenMessage,
  setActiveVoiceTab,
  getMicPermissionState,
} from './voice-bridge.js';

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function handleConnect(port) {
  if (port.name !== 'streaming') return;

  const senderTabId = port.sender?.tab?.id ?? null;
  let attachedTabId = null;
  let portAlive = true;

  function safePost(payload) {
    if (!portAlive) return;
    try {
      port.postMessage(payload);
    } catch (e) {
      portAlive = false;
      // Content often disconnects after 'done'; late complete/error must not throw.
      const msg = String(e?.message || e || '');
      if (!/disconnected port/i.test(msg)) {
        console.warn('[Neura] streaming port postMessage failed', e);
      }
    }
  }

  function onSendMessageComplete(response) {
    safePost({ type: 'complete', data: response });
  }

  function onSendMessageError(error, turnId) {
    console.error(error);
    const message = String(error?.message || error || 'Unknown error');
    safePost({ type: 'error', error: message, turnId: turnId || null });
  }

  function onAbortStreamConfirmed(aborted) {
    const tabId = attachedTabId ?? senderTabId;
    if (tabId != null) {
      const turn = turnState.getTurn(tabId);
      if (turn) turnState.endTurn(turn, 'aborted');
    }
    safePost({ type: 'abort_confirmed', aborted });
  }

  function onAbortAgentConfirmed() {
    const tabId = attachedTabId ?? senderTabId;
    if (tabId != null) {
      const turn = turnState.getTurn(tabId);
      if (turn) turnState.endTurn(turn, 'aborted');
    }
    safePost({ type: 'abort_agent_confirmed' });
  }

  function onStreamingPortMessage(request) {
    if (request.action === 'sendMessageToOpenWebUI') {
      attachedTabId = request.tabId ?? senderTabId;
      sendMessageToOpenWebUI(
        request.message,
        request.conversationHistory,
        request.pageContext,
        port,
        {
          agentMode: !!request.agentMode,
          visionScreenshots: request.visionScreenshots === true,
          tabId: attachedTabId,
          sessionKey: request.sessionKey || '',
          originalUrl: request.originalUrl || '',
          features: request.features || {},
          selectedToolIds: request.selectedToolIds || [],
          enabledKnowledgeIds: request.enabledKnowledgeIds || [],
          useKnowledge: !!request.useKnowledge,
          knowledgeAttachments: request.knowledgeAttachments || [],
          attachments: request.attachments || [],
          activeChatId: request.activeChatId || null,
          turnId: request.turnId || null,
          remoteHistory: request.remoteHistory || [],
          userMessageId: request.userMessageId || null,
          chatTitle: request.chatTitle || 'New Chat',
          branchParentId:
            request.branchParentId !== undefined ? request.branchParentId : null,
        },
      )
        .then(onSendMessageComplete)
        .catch((err) => onSendMessageError(err, request.turnId || null));
    } else if (request.action === 'rejoinTurn') {
      const tabId = request.tabId ?? senderTabId;
      attachedTabId = tabId;
      let turn = turnState.getActiveTurnForTab(tabId);
      let alreadyDone = false;
      if (!turn) {
        // Late rejoin after endTurn('done'): still deliver finalText once.
        const ended = turnState.getTurn(tabId);
        if (ended && ended.phase === 'done' && (ended.finalText || ended.partialContent)) {
          turn = ended;
          alreadyDone = true;
        }
      }
      if (!turn) {
        safePost({ type: 'no_active_turn' });
        return;
      }
      if (!alreadyDone) turnState.attachPort(turn, port);
      safePost({ type: 'rejoin_state', snapshot: turnState.buildRejoinSnapshot(turn) });
      if (!alreadyDone) {
        turnState.drainBufferTo(turn, port);
      } else {
        safePost({
          type: 'done',
          content: turn.finalText || turn.partialContent || '',
          turnId: turn.turnId,
          chatId: turn.chatId || null,
        });
      }
    } else if (request.action === 'abortStream') {
      abortStreaming(attachedTabId ?? senderTabId).then(onAbortStreamConfirmed);
    } else if (request.action === 'abortAgent') {
      setAgentAborted(true);
      clearAllAgentConfirms();
      abortStreaming(attachedTabId ?? senderTabId).then(onAbortAgentConfirmed);
    } else if (request.action === 'agentConfirmResponse') {
      resolveAgentConfirm(request.confirmId, request.approved);
    }
  }

  function onStreamingPortDisconnect() {
    portAlive = false;
    if (attachedTabId != null) {
      const turn = turnState.getTurn(attachedTabId);
      if (turn && turn.attachedPort === port) {
        turnState.detachPort(turn);
      }
    }
  }

  port.onMessage.addListener(onStreamingPortMessage);
  port.onDisconnect.addListener(onStreamingPortDisconnect);
}

export function handleRuntimeMessage(request, sender, sendResponse) {
  if (!request) return false;

  if (request.target === 'offscreen') {
    return false;
  }

  if (request.source === 'offscreen') {
    handleOffscreenMessage(request);
    return false;
  }

  if (!request.action) return false;

  if (request.action === 'abortStream') {
    abortStreaming(request.tabId ?? sender?.tab?.id ?? null)
      .then((aborted) => sendResponse({ aborted }))
      .catch(() => sendResponse({ aborted: false }));
    return true;
  }

  if (request.action === 'auth:status') {
    getAuthStatus()
      .then((status) => sendResponse(status))
      .catch(() => sendResponse({ loggedIn: false }));
    return true;
  }

  if (request.action === 'auth:signin') {
    signIn(request.email, request.password)
      .then((result) => sendResponse({ ok: true, user: result.user }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'auth:signout') {
    signOut()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'auth:getUser') {
    getCurrentUser()
      .then((user) => sendResponse({ user }))
      .catch(() => sendResponse({ user: null }));
    return true;
  }

  if (request.action === 'owui:ping') {
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'owui:probeServer') {
    const apiEndpoint = request.apiEndpoint || request.baseUrl;
    probeServerFromEndpoint(apiEndpoint)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'owui:getServerConfig') {
    getCachedServerConfig()
      .then((config) => sendResponse({ config }))
      .catch(() => sendResponse({ config: null }));
    return true;
  }

  if (request.action === 'owui:getBranding') {
    getOwUiBranding({ force: !!request.force })
      .then((branding) => sendResponse({ ok: true, ...branding }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: String(err.message || err),
          dataUrl: null,
          url: null,
          name: null,
        }),
      );
    return true;
  }

  if (request.action === 'owui:getModelProfileImage') {
    getModelProfileImage({
      modelId: request.modelId,
      profileImageUrl: request.profileImageUrl,
      force: !!request.force,
    })
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: String(err.message || err),
          dataUrl: null,
          modelId: String(request.modelId || ''),
        }),
      );
    return true;
  }

  if (request.action === 'owui:getAvailableFeatures') {
    (async () => {
      try {
        const modelId = request.modelId;
        const modelItem = request.modelItem || (modelId ? await fetchModelDetailPayload(modelId) : null);
        const available = await getAvailableFeatures(modelItem);
        const defaults = extractDefaultFeatures(modelItem);
        sendResponse({ available, defaults });
      } catch (err) {
        sendResponse({ error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'owui:getToolsList') {
    (async () => {
      try {
        const modelId = request.modelId || '';
        const toolsRaw = await fetchToolsList();
        const defaultToolIds = modelId ? await getModelToolIds(modelId) : [];
        const tools = mergeToolsForPicker(toolsRaw, defaultToolIds);
        const selected = modelId ? await getSelectedToolsForModel(modelId) : [];
        sendResponse({ tools, selected, defaultToolIds });
      } catch (err) {
        sendResponse({ error: String(err.message || err), tools: [], selected: [], defaultToolIds: [] });
      }
    })();
    return true;
  }

  if (request.action === 'owui:resetToolOverrides') {
    resetAllOverrides();
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'owui:setSelectedTools') {
    (async () => {
      try {
        await setSelectedToolsForModel(request.modelId, request.toolIds || []);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'owui:getModelKnowledge') {
    (async () => {
      try {
        const modelId = request.modelId || '';
        const items = modelId ? await getModelKnowledge(modelId) : [];
        const enabled = modelId ? resolveEffectiveKnowledge(modelId, items) : [];
        sendResponse({
          items,
          enabled: enabled.map((item) => item.id),
        });
      } catch (err) {
        sendResponse({ error: String(err.message || err), items: [], enabled: [] });
      }
    })();
    return true;
  }

  if (request.action === 'owui:setSelectedKnowledge') {
    (async () => {
      try {
        const modelId = request.modelId || '';
        const items = modelId ? await getModelKnowledge(modelId) : [];
        setKnowledgeSelection(modelId, request.enabledIds || [], items);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'owui:searchKnowledgeBases') {
    searchKnowledgeBases(request.query || '')
      .then((data) => sendResponse({ data }))
      .catch((err) => sendResponse({ error: String(err.message || err), data: [] }));
    return true;
  }

  if (request.action === 'owui:searchKnowledgeFiles') {
    searchKnowledgeFiles(request.query || '')
      .then((data) => sendResponse({ data }))
      .catch((err) => sendResponse({ error: String(err.message || err), data: [] }));
    return true;
  }

  if (request.action === 'owui:fetchFileContent') {
    fetchFileContentAsDataUrl(request.url || request.fileId || '')
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'owui:uploadFile') {
    (async () => {
      try {
        const fileName = request.fileName || 'upload.bin';
        const contentType = request.contentType || '';
        let bytes;
        if (typeof request.base64 === 'string' && request.base64) {
          bytes = base64ToUint8Array(request.base64);
        } else if (Array.isArray(request.bytes)) {
          bytes = new Uint8Array(request.bytes);
        } else {
          throw new Error('Missing file payload (base64)');
        }
        const uploaded = await uploadFile(bytes.buffer, fileName, { contentType });
        const fileId = uploaded?.id || uploaded?.file_id;
        if (!fileId) throw new Error('Upload succeeded but no file id returned');
        const attachment = await enrichFileAttachment(fileId, {
          name: fileName,
          contentType,
        });
        sendResponse({ ok: true, attachment, fileId });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'owui:uploadPageContext') {
    (async () => {
      try {
        const attachment = await uploadPageContextAsFile(
          {
            title: request.title,
            url: request.url,
            description: request.description,
            text: request.text,
          },
          { force: !!request.force },
        );
        sendResponse({ ok: true, attachment, fileId: attachment.id });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'owui:uploadImageFromUrl') {
    (async () => {
      const sourceUrl = String(request.url || '').trim();
      try {
        if (!sourceUrl) throw new Error('Missing image URL');
        const res = await fetch(sourceUrl);
        if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
        const contentType = res.headers.get('content-type') || 'image/*';
        if (!contentType.toLowerCase().startsWith('image/')) {
          throw new Error(`URL does not point to an image (content-type: ${contentType})`);
        }
        const buffer = await res.arrayBuffer();
        const fallbackName = sourceUrl.split('/').pop()?.split('?')[0] || 'image';
        const fileName = request.fileName || fallbackName;
        const uploaded = await uploadFile(buffer, fileName, { contentType });
        const fileId = uploaded?.id || uploaded?.file_id;
        if (!fileId) throw new Error('Upload succeeded but no file id returned');
        const attachment = await enrichFileAttachment(fileId, {
          name: fileName,
          contentType,
        });
        sendResponse({ ok: true, attachment, fileId });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'owui:ingestUrl') {
    (async () => {
      try {
        const attachment = await ingestUrlAsContextAttachment(request.url || '', {
          displayName: request.displayName || '',
        });
        sendResponse({ ok: true, attachment });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'getAvailableModels') {
    fetchAvailableModels()
      .then((models) => sendResponse({ data: models }))
      .catch((err) => sendResponse({ error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'getActiveTurn') {
    const tabId = sender?.tab?.id;
    if (tabId == null) {
      sendResponse({ active: false });
      return true;
    }
    const turn = turnState.getActiveTurnForTab(tabId);
    if (!turn) {
      sendResponse({ active: false });
    } else {
      sendResponse({ active: true, snapshot: turnState.buildRejoinSnapshot(turn) });
    }
    return true;
  }

  if (request.action === 'chats:list') {
    listUnifiedChats()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err), items: [] }));
    return true;
  }

  if (request.action === 'chats:get') {
    (async () => {
      try {
        if (request.remoteId && !request.localChatId) {
          const imported = await importRemoteChat(request.remoteId);
          if (!imported) {
            sendResponse({ ok: false, error: 'Chat not found on server' });
            return;
          }
          sendResponse({ ok: true, localId: imported.localId, chat: imported.chat });
          return;
        }
        const localChatId = request.localChatId;
        if (!localChatId) {
          sendResponse({ ok: false, error: 'Missing localChatId' });
          return;
        }
        const chat = await pullAndMergeLocalChat(localChatId);
        sendResponse({ ok: true, localId: localChatId, chat });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'chats:delete') {
    (async () => {
      try {
        const remoteId = await resolveRemoteId(request.localChatId, request.remoteId);
        if (remoteId) {
          const ok = await chatsApi.deleteChat(remoteId);
          if (request.localChatId) await syncStore.removeMapping(request.localChatId);
          sendResponse({ ok });
          return;
        }
        const ok = await deleteRemoteChat(request.localChatId || '');
        sendResponse({ ok });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'chats:deleteAll') {
    deleteAllChats()
      .then((result) =>
        sendResponse(
          typeof result === 'boolean'
            ? { ok: result }
            : {
                ok: !!result?.ok,
                keptRemoteIds: result?.keptRemoteIds || [],
                keptLocalIds: result?.keptLocalIds || [],
              },
        ),
      )
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'chats:push') {
    (async () => {
      try {
        const chat = await readLocalChat(request.localChatId);
        if (!chat) {
          sendResponse({ ok: false, error: 'Local chat not found' });
          return;
        }
        const { neuraModel } = await chrome.storage.sync.get(['neuraModel']);
        await pushFullChatBlob(
          request.localChatId,
          chat.messages || [],
          chat.title,
          neuraModel || 'NEURA-IANUSTEC',
        );
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'chats:pin') {
    (async () => {
      try {
        const remoteId = await resolveRemoteId(request.localChatId, request.remoteId);
        if (!remoteId) {
          sendResponse({ ok: false, error: 'not_synced' });
          return;
        }
        const ok = await chatsApi.togglePinChat(remoteId);
        sendResponse({ ok });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'chats:archive') {
    (async () => {
      try {
        const remoteId = await resolveRemoteId(request.localChatId, request.remoteId);
        if (!remoteId) {
          sendResponse({ ok: false, error: 'not_synced' });
          return;
        }
        const ok = await chatsApi.toggleArchiveChat(remoteId);
        sendResponse({ ok });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'chats:pinnedList') {
    chatsApi
      .listPinnedChats()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err), items: [] }));
    return true;
  }

  if (request.action === 'chats:archivedList') {
    chatsApi
      .listArchivedChats()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err), items: [] }));
    return true;
  }

  if (request.action === 'chats:search') {
    chatsApi
      .searchChats(request.text || '')
      .then((items) => sendResponse({ ok: true, items }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err), items: [] }));
    return true;
  }

  if (request.action === 'chats:tags:get') {
    (async () => {
      try {
        const remoteId = request.remoteId || (await syncStore.getMapping(request.localChatId || ''))?.remoteId;
        if (!remoteId) {
          sendResponse({ ok: true, items: [] });
          return;
        }
        const items = await chatsApi.getChatTags(remoteId);
        sendResponse({ ok: true, items });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err), items: [] });
      }
    })();
    return true;
  }

  if (request.action === 'chats:tags:add' || request.action === 'chats:tags:remove') {
    (async () => {
      try {
        const remoteId = await resolveRemoteId(request.localChatId, request.remoteId);
        if (!remoteId) {
          sendResponse({ ok: false, error: 'not_synced' });
          return;
        }
        const ok =
          request.action === 'chats:tags:add'
            ? await chatsApi.addChatTag(remoteId, request.name)
            : await chatsApi.removeChatTag(remoteId, request.name);
        if (ok && request.localChatId) {
          const local = await readLocalChat(request.localChatId);
          if (local) {
            const current = new Set(Array.isArray(local.tags) ? local.tags : []);
            if (request.action === 'chats:tags:add') current.add(request.name);
            else current.delete(request.name);
            local.tags = Array.from(current);
            await writeLocalChat(local);
          }
        }
        sendResponse({ ok });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'chats:tags:all') {
    chatsApi
      .getAllTags()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err), items: [] }));
    return true;
  }

  if (request.action === 'chats:share') {
    (async () => {
      try {
        const remoteId = await resolveRemoteId(request.localChatId, request.remoteId);
        if (!remoteId) {
          sendResponse({ ok: false, error: 'not_synced' });
          return;
        }
        const result = await chatsApi.shareChat(remoteId);
        const shareId = result?.id || result?.share_id || null;
        if (!shareId) {
          sendResponse({ ok: false, error: 'No share id returned' });
          return;
        }
        const { BASE_URL } = await getEndpoints();
        sendResponse({ ok: true, url: `${BASE_URL}/s/${shareId}` });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'chats:duplicate') {
    (async () => {
      try {
        const remoteId = await resolveRemoteId(request.localChatId, request.remoteId);
        if (!remoteId) {
          sendResponse({ ok: false, error: 'not_synced' });
          return;
        }
        const cloned = await chatsApi.cloneChat(remoteId, {
          title: request.title || null,
        });
        const newRemoteId = cloned?.id || cloned?.chat_id || cloned?.chat?.id;
        if (!newRemoteId) {
          sendResponse({
            ok: false,
            error: cloned
              ? 'Clone did not return a new chat id'
              : 'Clone failed (server rejected the request)',
          });
          return;
        }
        const imported = await importRemoteChat(newRemoteId);
        sendResponse({ ok: !!imported, localId: imported?.localId || null, chat: imported?.chat || null });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'chats:message:delete') {
    (async () => {
      try {
        const remoteId = request.remoteId || (await syncStore.getMapping(request.localChatId || ''))?.remoteId;
        let ok = true;
        if (remoteId && request.messageId) {
          ok = await chatsApi.deleteChatMessage(remoteId, request.messageId);
        }
        if (request.localChatId && request.messageId) {
          const local = await readLocalChat(request.localChatId);
          if (local && Array.isArray(local.messages)) {
            local.messages = local.messages.filter((m) => m.id !== request.messageId);
            await writeLocalChat(local);
          }
        }
        sendResponse({ ok });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'folders:list') {
    chatsApi
      .listFolders()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err), items: [] }));
    return true;
  }

  if (request.action === 'folders:create') {
    chatsApi
      .createFolder(request.name || '', { parentId: request.parentId || null })
      .then((folder) => sendResponse({ ok: !!folder, folder }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'folders:createPath') {
    chatsApi
      .createFolderPath(request.path || request.name || '', request.parentId || null)
      .then((folder) => sendResponse({ ok: !!folder, folder }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'folders:update') {
    chatsApi
      .updateFolder(request.folderId || '', { name: request.name })
      .then((folder) => sendResponse({ ok: !!folder, folder }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'folders:move') {
    chatsApi
      .updateFolderParent(request.folderId || '', request.parentId || null)
      .then((folder) => sendResponse({ ok: !!folder, folder }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'folders:duplicate') {
    chatsApi
      .duplicateFolder(request.folderId || '', {
        includeChats: request.includeChats !== false,
        includeChildren: request.includeChildren !== false,
      })
      .then((folder) => sendResponse({ ok: !!folder, folder }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'folders:delete') {
    chatsApi
      .deleteFolder(request.folderId || '', {
        deleteContents: request.deleteContents === true,
      })
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'folders:chats') {
    (async () => {
      try {
        const { CHATS_BY_FOLDER } = await getEndpoints();
        const response = await apiFetch(CHATS_BY_FOLDER(request.folderId || ''), { method: 'GET' });
        if (!response.ok) {
          sendResponse({ ok: false, items: [] });
          return;
        }
        const data = await response.json();
        const items = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
        sendResponse({ ok: true, items });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err), items: [] });
      }
    })();
    return true;
  }

  if (request.action === 'chats:moveToFolder') {
    (async () => {
      try {
        const remoteId = await resolveRemoteId(request.localChatId, request.remoteId);
        if (!remoteId) {
          sendResponse({ ok: false, error: 'not_synced' });
          return;
        }
        const folderId = request.folderId || null;
        const ok = await chatsApi.moveChatToFolder(remoteId, folderId);
        if (ok && request.localChatId) {
          await setLocalChatFolder(request.localChatId, folderId);
        }
        sendResponse({ ok });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'chats:createInFolder') {
    (async () => {
      try {
        const result = await createChatInFolder({
          title: request.title || '',
          model: request.model || '',
          folderId: request.folderId || '',
        });
        sendResponse({
          ok: true,
          localId: result.localId,
          remoteId: result.remoteId,
          chat: result.chat,
        });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'audio:transcribe') {
    (async () => {
      try {
        if (!request.base64) throw new Error('Missing audio payload');
        const blob = base64ToBlob(request.base64, request.mimeType || 'audio/webm');
        const text = await transcribeAudio(blob, {
          mimeType: request.mimeType || blob.type,
          language: request.language || undefined,
          fileName: request.fileName,
        });
        sendResponse({ ok: true, text });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (request.action === 'audio:voices') {
    listVoices()
      .then((voices) => sendResponse({ ok: true, voices }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err), voices: [] }));
    return true;
  }

  if (request.action === 'audio:speech') {
    synthesizeSpeech(request.text, { voice: request.voice, model: request.model })
      .then((audio) => sendResponse({ ok: true, ...audio }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'voice:startRecording') {
    setActiveVoiceTab(sender?.tab?.id ?? null);
    sendToOffscreen({ action: 'voice:startRecording' }, { waitFor: true, timeoutMs: 15000 })
      .then((res) => sendResponse(res || { ok: false, error: 'No response' }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'voice:stopRecording') {
    sendToOffscreen({ action: 'voice:stopRecording' }, { waitFor: true, timeoutMs: 30000 })
      .then((res) => sendResponse(res || { ok: false, error: 'No recording' }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'voice:startBargeIn') {
    setActiveVoiceTab(sender?.tab?.id ?? null);
    sendToOffscreen({ action: 'voice:startBargeIn' }, { waitFor: true, timeoutMs: 10000 })
      .then((res) => sendResponse(res || { ok: false, error: 'No response' }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'voice:stopBargeIn') {
    sendToOffscreen({ action: 'voice:stopBargeIn' }, { waitFor: true, timeoutMs: 5000 })
      .then((res) => sendResponse(res || { ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'voice:playAudio') {
    setActiveVoiceTab(sender?.tab?.id ?? null);
    sendToOffscreen(
      { action: 'voice:playAudio', base64: request.base64, mimeType: request.mimeType },
      { waitFor: true, timeoutMs: 15000 },
    )
      .then((res) => sendResponse(res || { ok: false, error: 'No response' }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'voice:stopPlayback') {
    sendToOffscreen({ action: 'voice:stopPlayback' }, { waitFor: true, timeoutMs: 5000 })
      .then((res) => sendResponse(res || { ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'voice:stopSession') {
    setActiveVoiceTab(null);
    sendToOffscreen({ action: 'voice:stopSession' }, { waitFor: true, timeoutMs: 10000 })
      .then((res) => sendResponse(res || { ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'voice:getMicPermissionState') {
    getMicPermissionState()
      .then((res) => sendResponse(res || { ok: true, state: 'unknown' }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err), state: 'unknown' }));
    return true;
  }

  if (request.action === 'prompts:list' || request.action === 'owui:searchPrompts') {
    const query = request.query || '';
    const runner = query ? promptsApi.searchPrompts(query) : promptsApi.listPrompts();
    runner
      .then((items) => sendResponse({ ok: true, items, data: items }))
      .catch((err) =>
        sendResponse({ ok: false, error: String(err.message || err), items: [], data: [] }),
      );
    return true;
  }

  if (request.action === 'prompts:getByCommand') {
    promptsApi
      .getPromptByCommand(request.command || '')
      .then((prompt) => sendResponse({ ok: !!prompt, prompt }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'prompts:create') {
    promptsApi
      .createPrompt(request.prompt || request)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'prompts:delete') {
    promptsApi
      .deletePromptById(request.promptId || request.id)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'notes:list') {
    notesApi
      .listNotes(request.page || 1)
      .then((items) => sendResponse({ ok: true, items }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err), items: [] }));
    return true;
  }

  if (request.action === 'notes:search') {
    notesApi
      .searchNotes(request.query || '', request.page || 1)
      .then((items) => sendResponse({ ok: true, items }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err), items: [] }));
    return true;
  }

  if (request.action === 'notes:get') {
    notesApi
      .getNote(request.noteId || request.id || '')
      .then((note) => sendResponse({ ok: !!note, note }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'notes:create') {
    notesApi
      .createNote({ title: request.title, markdown: request.markdown })
      .then((note) => sendResponse({ ok: !!note, note }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'notes:update') {
    notesApi
      .updateNote(request.noteId || request.id || '', {
        title: request.title,
        markdown: request.markdown,
      })
      .then((note) => sendResponse({ ok: !!note, note }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === 'notes:delete') {
    notesApi
      .deleteNote(request.noteId || request.id || '')
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  return false;
}
