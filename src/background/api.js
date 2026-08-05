import {
  newAbortController,
  abortStreaming,
  releaseAbortController,
} from './stream-controller.js';
import {
  buildBrowserToolServer,
  openBrowserToolSession,
} from './agent/browser-tool-bridge.js';
import { resetAgentAborted } from './agent/agent-abort.js';
import { getEndpoints } from './constants.js';
import { createTemporaryChatId } from './owui-chat-id.js';
import { streamChatCompletion } from './stream-chat.js';
import * as turnState from './turn-state.js';
import { ensureAuthenticated, getCurrentUser } from './auth.js';
import { apiFetch } from './api-client.js';
import {
  buildChatCompletionPayload,
  buildTemplateVariables,
  extractDefaultFeatures,
  extractFilterIds,
} from './chat-payload.js';
import {
  extractModelKnowledge,
  extractModelToolIds,
  fetchModelDetailPayload,
  getModelFunctionCalling,
  invalidateModelMetadataCache,
} from './model-metadata.js';
import { resolveToolIdsForRequest } from './tools-registry.js';
import { resolveKnowledgeFilesForRequest } from './knowledge-registry.js';
import * as socketService from './socket-service.js';
import {
  executeOwUiImageToolCalls,
  OWUI_IMAGE_TOOL_NAMES,
} from './images-api.js';
import {
  applyUserMessageContent,
  buildImageReferenceContextMessage,
  splitAttachmentsForCompletion,
} from './attachments.js';
import { ensureRemoteChat, applyGeneratedChatMeta, pushTurnToServer } from './chat-sync.js';
import { getServerCapabilities } from './openwebui-config.js';
import * as outbox from './outbox.js';
import {
  extractFileId,
  fetchFileContentAsDataUrl,
  uploadImageDataUrlAsFile,
  uploadPageContextAsFile,
} from './files-api.js';
import { captureVisionFrame } from './agent/browser-actions.js';
import { dlog, dwarn } from './debug-log.js';
// Chat history is cached locally and synced bidirectionally with Open WebUI.
// Socket.IO is used for realtime delivery of server-side tool execution.

// Model metadata (function-calling mode, tool ids, model detail fetches) is
// centralized in model-metadata.js — imported above — to avoid duplicate
// caches drifting out of sync.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.neuraModel || changes.neuraAPIEndpoint)) {
    invalidateModelMetadataCache();
  }
  if (area === 'local' && changes.neuraSession) {
    invalidateModelMetadataCache();
  }
});

/**
 * @param {number|null} tabId
 * @param {object} message
 */
function sendToTab(tabId, message) {
  if (tabId == null) return;
  try {
    chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    /* tab may have navigated away/closed; ignore */
  }
}

/**
 * Handle the lifecycle events Open WebUI emits *after* the assistant message is
 * complete: outlet filters, generated title and tags, follow-up suggestions and
 * the terminal `chat:active {active:false}`.
 *
 * They arrive on the same persistent socket consumer as the answer itself
 * (owui-turn-channel.js), which is why nothing here polls the server. Delivery
 * to the page uses runtime messages because the streaming port is usually
 * already closed by the time the server finishes this tail work.
 *
 * @param {number|null} tabId
 * @param {string|null} localChatId
 * @returns {(msg: object) => void}
 */
function createTurnNotifier(tabId, localChatId) {
  return (msg) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'owui_title':
      case 'owui_tags': {
        if (!localChatId) return;
        const meta = msg.type === 'owui_title' ? { title: msg.title } : { tags: msg.tags };
        applyGeneratedChatMeta(localChatId, meta)
          .then((updated) => {
            if (!updated) return;
            sendToTab(tabId, {
              action: 'chat_meta_updated',
              chatId: localChatId,
              title: updated.title,
              tags: updated.tags,
            });
          })
          .catch((e) => dwarn('api', 'applyGeneratedChatMeta failed', e));
        return;
      }
      case 'owui_follow_ups':
        sendToTab(tabId, {
          action: 'chat_follow_ups',
          chatId: localChatId,
          items: msg.items || [],
        });
        return;
      case 'chat_active':
        sendToTab(tabId, {
          action: 'chat_active',
          chatId: localChatId,
          active: !!msg.active,
        });
        return;
      default:
        dlog('api', 'turn lifecycle event', { type: msg.type, chatId: msg.chatId });
    }
  };
}

/**
 * Upload page scrape as an OWUI file and merge into the turn's files[] (deduped).
 * Skipped when the user attached images (same rule as the old system inject).
 * @param {object|null|undefined} pageContext
 * @param {object[]} topLevelFiles
 * @param {boolean} hasTurnImages
 * @returns {Promise<object[]>}
 */
async function mergePageContextFile(pageContext, topLevelFiles, hasTurnImages) {
  const files = Array.isArray(topLevelFiles) ? [...topLevelFiles] : [];
  if (hasTurnImages) {
    dlog('page-context', 'skip upload: turn has images', {
      images: true,
      existingFiles: files.length,
    });
    return files;
  }
  if (!pageContext?.text && !pageContext?.description) {
    dlog('page-context', 'skip upload: no pageContext text/description', {
      pageContext: pageContext
        ? { title: pageContext.title, url: pageContext.url, textLen: 0 }
        : null,
      existingFiles: files.map((f) => ({
        id: f?.id,
        name: f?.name,
        type: f?.type,
        context: f?.context,
        sourceUrl: f?.sourceUrl,
      })),
    });
    return files;
  }
  const url = String(pageContext.url || '').trim();
  const textLen = String(pageContext.text || '').length;
  dlog('page-context', 'merge start', {
    title: pageContext.title,
    url,
    textLen,
    descriptionLen: String(pageContext.description || '').length,
    existingFiles: files.length,
  });

  try {
    const t0 = Date.now();
    // Always upload (or cache-hit by url+content hash). URL-only dedup was wrong:
    // a prior thin attach (e.g. 247 chars) blocked a fresher scrape (e.g. 4834 chars).
    const attachment = await uploadPageContextAsFile(pageContext);
    dlog('page-context', 'upload ok', {
      fileId: attachment.id,
      name: attachment.name,
      context: attachment.context,
      sourceUrl: attachment.sourceUrl,
      ms: Date.now() - t0,
    });

    const sameIdIdx = files.findIndex(
      (f) => f && (f.id === attachment.id || f.url === attachment.id),
    );
    if (sameIdIdx >= 0) {
      dlog('page-context', 'dedup: same file id already in files[]', {
        id: attachment.id,
        url,
      });
      // Refresh metadata/name on the existing slot.
      files[sameIdIdx] = { ...files[sameIdIdx], ...attachment };
      return files;
    }

    const sameUrlIdx = url
      ? files.findIndex((f) => {
          if (!f || typeof f !== 'object') return false;
          const src =
            f.sourceUrl ||
            f.meta?.source ||
            (String(f.url || '').startsWith('http') ? f.url : '') ||
            '';
          return src === url || f.name === url;
        })
      : -1;

    if (sameUrlIdx >= 0) {
      const prev = files[sameUrlIdx];
      dlog('page-context', 'replace stale page file (same URL, different content/id)', {
        url,
        prevId: prev?.id,
        prevName: prev?.name,
        nextId: attachment.id,
        nextName: attachment.name,
        scrapeTextLen: textLen,
      });
      files[sameUrlIdx] = attachment;
    } else {
      files.push(attachment);
      dlog('page-context', 'files[] after merge', {
        count: files.length,
        ids: files.map((f) => f?.id),
      });
    }
  } catch (e) {
    dwarn('page-context', 'upload failed', e);
  }
  return files;
}

async function resolveChatRequestContext(
  selectedModel,
  uiFeatures,
  selectedToolIds,
  useKnowledge,
  enabledKnowledgeIds,
) {
  const modelItem = await fetchModelDetailPayload(selectedModel);
  const fcMode = await getModelFunctionCalling(selectedModel);
  const modelDefaultToolIds = extractModelToolIds(modelItem);
  const toolIds = await resolveToolIdsForRequest(
    selectedModel,
    modelDefaultToolIds,
    selectedToolIds,
    useKnowledge,
  );
  const modelDefaultKnowledge = extractModelKnowledge(modelItem);
  const knowledgeFiles = resolveKnowledgeFilesForRequest(
    selectedModel,
    modelDefaultKnowledge,
    enabledKnowledgeIds,
  );
  const modelDefaults = extractDefaultFeatures(modelItem);
  const features = {
    web_search: uiFeatures.web_search ?? modelDefaults.web_search,
    image_generation: uiFeatures.image_generation ?? modelDefaults.image_generation,
    code_interpreter: uiFeatures.code_interpreter ?? modelDefaults.code_interpreter,
    memory: uiFeatures.memory ?? modelDefaults.memory,
  };
  const user = await getCurrentUser();
  const variables = buildTemplateVariables(user);
  const filterIds = extractFilterIds(modelItem);
  const mcpIds = toolIds.filter((id) => String(id).startsWith('server:mcp:'));
  console.log(
    `[Neura] resolved tool_ids=${toolIds.length} mcp=${mcpIds.length}` +
      (mcpIds.length ? ` [${mcpIds.join(', ')}]` : '') +
      (toolIds.length <= 20 ? ` all=[${toolIds.join(', ')}]` : ''),
  );
  console.log(
    `[Neura] model knowledge files=${knowledgeFiles.length}` +
      (knowledgeFiles.length <= 10
        ? ` [${knowledgeFiles.map((f) => f.name || f.id).join(', ')}]`
        : ''),
  );
  console.log(
    `[Neura] features web_search=${!!features.web_search} image_generation=${!!features.image_generation} ` +
      `code_interpreter=${!!features.code_interpreter} memory=${!!features.memory} fc=${fcMode}`,
  );
  return { modelItem, fcMode, toolIds, knowledgeFiles, features, variables, filterIds };
}

/**
 * Merge model-default knowledge attachments into the turn files array.
 * Manual user attachments win on id/collection_name conflicts.
 * @param {object[]} topLevelFiles
 * @param {object[]} knowledgeFiles
 * @returns {object[]}
 */
function mergeKnowledgeFilesIntoAttachments(topLevelFiles, knowledgeFiles) {
  if (!Array.isArray(knowledgeFiles) || knowledgeFiles.length === 0) {
    return Array.isArray(topLevelFiles) ? topLevelFiles : [];
  }
  const merged = Array.isArray(topLevelFiles) ? topLevelFiles.slice() : [];
  const seen = new Set(
    merged.map((f) => String(f?.id || f?.collection_name || f?.name || '')).filter(Boolean),
  );
  for (const file of knowledgeFiles) {
    const key = String(file?.id || file?.collection_name || file?.name || '');
    if (!key || seen.has(key)) continue;
    merged.push(file);
    seen.add(key);
  }
  return merged;
}

/**
 * Which application the user is looking at, derived from the tab URL.
 * The leading host label is what identifies the product in practice
 * (`odoo.example.com`, `nextcloud.example.com`), and it stays generic: no
 * hardcoded product list, so it works for whatever integrations an account has.
 * @param {object|null|undefined} pageContext
 * @returns {{ host: string, app: string, title: string }|null}
 */
function describeActiveApp(pageContext) {
  const rawUrl = String(pageContext?.url || '').trim();
  if (!rawUrl) return null;

  let host = '';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    host = parsed.hostname;
  } catch {
    return null;
  }
  if (!host) return null;

  const labels = host.replace(/^www\./i, '').split('.');
  const app = labels[0] || host;
  return { host, app, title: String(pageContext?.title || '').trim() };
}

/**
 * Only the extension knows which application the user is actually working in,
 * and that is exactly what disambiguates a request several integrations could
 * serve ("send a message to Mattia" from inside Odoo vs from inside Nextcloud).
 * Without it the server picks whichever integration matches the wording first.
 * @param {object|null|undefined} pageContext
 * @returns {string|null}
 */
function buildActiveAppContextMessage(pageContext) {
  const active = describeActiveApp(pageContext);
  if (!active) return null;

  return (
    `## Where the user is right now\n` +
    `The user is working in this browser tab:\n` +
    `- Application host: ${active.host} (identifier: "${active.app}")\n` +
    (active.title ? `- Page title: ${active.title}\n` : '') +
    `\n` +
    `Integration routing: when a request could be served by more than one of your ` +
    `workspace/MCP integrations — sending a message, creating a task or record, looking ` +
    `up a person or a document — prefer the integration belonging to the application in ` +
    `this tab, because the user is asking from inside it. Pick a different integration ` +
    `only when the user names one explicitly, when no integration matches this ` +
    `application, or when the request is clearly unrelated to it.`
  );
}

/**
 * Agent mode adds browser automation to an otherwise normal chat, so this prompt
 * only describes that extra. Every other tool — workspace, MCP, built-ins — is
 * called exactly as in a normal chat and needs no instructions from here, and
 * business rules belong on OWUI / the model.
 * @param {object|null|undefined} pageContext
 */
function buildAgentSystemPrompt(pageContext) {
  const baseUrl = pageContext?.url || 'unknown';
  return (
    `You are Neura, an AI assistant running inside a browser extension. On top of your usual tools ` +
    `you can act on the browser tab the user is looking at.\n\n` +
    `## Goal for this turn\n` +
    `The user's latest message is the objective of the whole turn. Keep working on that objective until it is done, ` +
    `or until you are blocked and must ask for one missing piece. Screenshots, page context, DOM snapshots and tool ` +
    `results are observations that help you act — they are never a new user request. If the user asked for an action ` +
    `(send a message, fill a form, navigate, click, look something up), do not switch to describing the page instead.\n\n` +
    `## Browser-automation tools (the user's ACTIVE TAB)\n` +
    `read_dom_snapshot, query_elements, get_element_text, click_element, fill_input, press_key, focus_element, scroll_to, submit_form, wait_for_selector, navigate_same_origin, open_maps_directions, navigate, open_new_tab, download_file, take_screenshot.\n` +
    `Use them only to read, click, fill, scroll, navigate, download or screenshot that tab.\n` +
    `After click_element, navigate or navigate_same_origin, verify the new state (read_dom_snapshot / query_elements, ` +
    `or take_screenshot for layout) and continue the same objective. Do not stop with a page description.\n\n` +
    `## Everything else\n` +
    `Your other tools (workspace and MCP integrations such as Nextcloud, CRM or project management, knowledge base, notes, chat history) work as they always do: call them directly. ` +
    `When the user's action belongs to the application in this tab (e.g. messaging or records in that product), prefer that ` +
    `integration over clicking through the UI, unless the user explicitly asks you to use the page. ` +
    `Never replace integrations with browser automation for reading documents, and never use download_file to read a document — it saves a file for the user and returns no content.\n\n` +
    `## Style\n` +
    `Be concise. Prefer one tool call over many when a single call is enough.\n` +
    `After navigate / navigate_same_origin succeeds, the page has changed: you MUST call read_dom_snapshot (or query_elements / get_element_text) on the NEW page before summarizing or answering about its content. Do not treat navigation alone as completing a research or summary request.\n` +
    `The current tab URL below is context only, never a constraint unless the user is explicitly asking about that page.\n\n` +
    `## Visual context\n` +
    `Call take_screenshot when you need layout, popups, form state or icons that a text snapshot misses. ` +
    `The capture is shown to the user; for structure and selectors after a capture, call read_dom_snapshot or query_elements. ` +
    `A screenshot is never a signal that the user only wanted a description of the page.\n` +
    `Current page URL: ${baseUrl}.`
  );
}

function extractUserTextPrompt(messageContent, fallbackMessage) {
  if (typeof messageContent === 'string') return messageContent.trim();
  if (Array.isArray(messageContent)) {
    for (const part of messageContent) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text.trim();
      }
    }
  }
  return String(fallbackMessage || '').trim();
}

/**
 * Bare OWUI file ids are not fetchable by the model vision stack. Resolve them
 * to authenticated data URLs so the model can actually see attached images.
 * Leaves data:/http(s) URLs unchanged. On failure, keeps the original ref.
 * @param {string | object[]} messageContent
 * @returns {Promise<string | object[]>}
 */
async function resolveVisionImageUrlsInContent(messageContent) {
  if (!Array.isArray(messageContent)) return messageContent;
  const out = [];
  for (const part of messageContent) {
    if (!part || part.type !== 'image_url') {
      out.push(part);
      continue;
    }
    const url = String(part.image_url?.url || '').trim();
    if (!url || url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
      out.push(part);
      continue;
    }
    const fileId = extractFileId(url);
    const isOwUiFileRef =
      !!fileId ||
      url.startsWith('/api/v1/files/') ||
      /^[a-f0-9-]{8,}$/i.test(url);
    if (!isOwUiFileRef) {
      out.push(part);
      continue;
    }
    try {
      const { dataUrl } = await fetchFileContentAsDataUrl(fileId || url);
      out.push({
        ...part,
        image_url: { ...(part.image_url || {}), url: dataUrl },
      });
    } catch (e) {
      console.warn('[Neura] failed to resolve vision image_url to data URL', e);
      out.push(part);
    }
  }
  return out;
}

/**
 * Append a page screenshot as a vision image_url part on the user turn.
 * The attachment must already be uploaded to the OWUI Files API — its stable
 * file id/url is what gets referenced here, never a raw `data:` URL, so the
 * same content survives persistence and reload exactly like OWUI's own
 * multimodal messages.
 * @param {string | object[]} messageContent
 * @param {object} attachment OWUI file descriptor { id, url, ... }
 * @returns {object[]}
 */
function appendPageScreenshotToContent(messageContent, attachment) {
  const parts = [];
  if (typeof messageContent === 'string') {
    if (messageContent) parts.push({ type: 'text', text: messageContent });
  } else if (Array.isArray(messageContent)) {
    parts.push(...messageContent);
  }
  parts.push({ type: 'text', text: 'Screenshot aggiornato della pagina (contesto visivo):' });
  parts.push({ type: 'image_url', image_url: { url: attachment.url || attachment.id } });
  return parts;
}

export async function sendMessageToOpenWebUI(message, conversationHistory, pageContext, port, options = {}) {
  const {
    agentMode = false,
    visionScreenshots = false,
    tabId = null,
    sessionKey = '',
    originalUrl = '',
    features: uiFeatures = {},
    selectedToolIds = [],
    enabledKnowledgeIds = [],
    useKnowledge = false,
    knowledgeAttachments = [],
    attachments = [],
    activeChatId = null,
    turnId = null,
    remoteHistory = [],
    userMessageId = null,
    chatTitle = 'New Chat',
    branchParentId = null,
  } = options;

  const turnT0 = Date.now();
  dlog('chat', 'sendMessage start', {
    agentMode,
    turnId,
    activeChatId,
    tabId,
    sessionKey: sessionKey ? String(sessionKey).slice(0, 24) : '',
    historyLen: Array.isArray(conversationHistory) ? conversationHistory.length : 0,
    remoteHistoryLen: Array.isArray(remoteHistory) ? remoteHistory.length : 0,
    attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
    knowledgeAttachmentCount: Array.isArray(knowledgeAttachments) ? knowledgeAttachments.length : 0,
    selectedToolIds: Array.isArray(selectedToolIds) ? selectedToolIds.length : 0,
    features: uiFeatures,
    pageContext: pageContext
      ? {
          title: pageContext.title || null,
          url: pageContext.url || null,
          textLen: pageContext.text ? String(pageContext.text).length : 0,
          descriptionLen: pageContext.description ? String(pageContext.description).length : 0,
        }
      : null,
    messagePreview: String(message || '').slice(0, 80),
  });

  try {
    await ensureAuthenticated();
  } catch (e) {
    throw String(e.message || e);
  }
  dlog('chat', 'authenticated', { elapsedMs: Date.now() - turnT0 });

  // The server just answered, so connectivity is confirmed — a good moment
  // to flush any turns that failed to sync while offline.
  outbox.drainQueue().catch(() => {});

  const { neuraModel } = await chrome.storage.sync.get(['neuraModel']);
  const selectedModel = neuraModel || 'NEURA-IANUSTEC';

  // Unify legacy knowledgeAttachments with composer attachments (files/web/KB).
  const allAttachments = [
    ...(Array.isArray(attachments) ? attachments : []),
    ...(Array.isArray(knowledgeAttachments) ? knowledgeAttachments : []),
  ];
  const { messageContent: splitContent, topLevelFiles, images: turnImages } =
    splitAttachmentsForCompletion(allAttachments, message);

  const hasTurnImages = turnImages.length > 0;

  // OWUI's own web client NEVER persists `content` as a multimodal array —
  // Chat.svelte only builds `[{type:'text',...}, {type:'image_url',...}]`
  // in memory, right before the /api/chat/completions call, and history
  // always stores plain text (UserMessage.svelte renders `message.content`
  // straight into <Markdown>, which breaks/hangs on a non-string value).
  // Images are attached purely via `files[]`. Persisting an array here is
  // exactly what corrupted chats in the OWUI sidebar/navbar.
  const messageContent = typeof message === 'string' ? message : String(message || '');

  // Wire-format content for the actual /api/chat/completions call only —
  // built from the split text+image_url parts, never persisted.
  let completionContent = splitContent;

  // Toggle Screenshot: attach a capture of the tab to the turn (normal chat only).
  // In agent mode this auto-attach is skipped — it reads as “the user sent a
  // screenshot to describe” and derails action tasks. The agent can still call
  // take_screenshot when it needs a capture. Uploaded to the OWUI Files API so
  // the image is referenced by a stable file id/URL (never a raw `data:` URL).
  /** @type {object|null} */
  let visionScreenshotAttachment = null;
  if (visionScreenshots && !agentMode && tabId != null) {
    try {
      const shot = await captureVisionFrame(tabId);
      if (shot.ok && shot.dataUrl) {
        visionScreenshotAttachment = await uploadImageDataUrlAsFile(shot.dataUrl, {
          name: `screenshot-${Date.now()}.jpg`,
          context: 'vision',
        });
        completionContent = appendPageScreenshotToContent(completionContent, visionScreenshotAttachment);
      }
    } catch (e) {
      console.warn('[Neura] vision screenshot (normal chat) failed', e);
    }
  }

  const imageAttachmentsForPersist = [
    ...turnImages,
    ...(visionScreenshotAttachment ? [visionScreenshotAttachment] : []),
  ];

  // Bare OWUI file ids are not fetchable by the model vision stack on this
  // deployment, so resolve every image_url part to an authenticated data URL
  // just for this request — `messageContent` (persisted) is never touched.
  if (hasTurnImages || visionScreenshotAttachment) {
    completionContent = await resolveVisionImageUrlsInContent(completionContent);
  }

  const messages = [];

  if (agentMode) {
    messages.push({
      role: 'system',
      content: buildAgentSystemPrompt(pageContext),
    });
  }

  // Applies to normal chats too: the integrations run server-side in both modes,
  // so both need to know which application the user is asking from.
  const activeAppContext = buildActiveAppContextMessage(pageContext);
  if (activeAppContext) {
    messages.push({
      role: 'system',
      content: activeAppContext,
    });
    dlog('chat', 'active app context attached', describeActiveApp(pageContext));
  }

  // The model only "sees" attached images via opaque image_url vision parts —
  // it never reads that url/id as text, so without this it cannot know what
  // to pass to the native edit_image tool. Spells out the exact reference
  // string per attached image (see attachments.js for details).
  const imageReferenceContext = buildImageReferenceContextMessage(turnImages);
  if (imageReferenceContext) {
    messages.push({
      role: 'system',
      content: imageReferenceContext,
    });
  }

  messages.push(...(conversationHistory || []));
  messages.push({ role: 'user', content: completionContent });
  // Ensure last user message uses split content (history may already include a user turn).
  applyUserMessageContent(messages, completionContent);

  await abortStreaming(tabId);

  // Clears a Stop from an earlier turn so this turn's browser tools can run.
  if (agentMode) resetAgentAborted();

  const assistantMessageId = crypto.randomUUID();
  const turn =
    tabId != null
      ? turnState.beginTurn(tabId, {
          turnId: turnId || undefined,
          chatId: activeChatId,
          assistantMessageId,
          originalUrl,
          sessionKey,
          model: selectedModel,
          agentMode,
          port,
        })
      : null;

  const broadcast = (ev) => {
    if (turn) turnState.broadcast(turn, ev);
    else if (port) port.postMessage(ev);
  };

  if (visionScreenshotAttachment) {
    broadcast({
      type: 'vision:screenshot',
      attachment: visionScreenshotAttachment,
      turnId: turn?.turnId || turnId || null,
    });
  }

  // Page text → OWUI file → files[] (server injects into the user turn).
  // Done once here so both agent and normal chat share the same list.
  const filesWithPage = await mergePageContextFile(pageContext, topLevelFiles, hasTurnImages);
  dlog('chat', 'turn files ready for completion', {
    agentMode,
    model: selectedModel,
    elapsedMs: Date.now() - turnT0,
    pageContextUrl: pageContext?.url || null,
    pageContextTextLen: pageContext?.text ? String(pageContext.text).length : 0,
    attachmentCount: allAttachments.length,
    topLevelFiles: topLevelFiles.map((f) => ({
      id: f?.id,
      type: f?.type,
      name: f?.name,
      context: f?.context,
      sourceUrl: f?.sourceUrl,
    })),
    filesWithPage: filesWithPage.map((f) => ({
      id: f?.id,
      type: f?.type,
      name: f?.name,
      context: f?.context,
      sourceUrl: f?.sourceUrl,
    })),
    systemRoles: messages.filter((m) => m.role === 'system').length,
    userPreview: extractUserTextPrompt(messageContent, message).slice(0, 80),
  });

  if (agentMode && tabId == null) {
    throw new Error('Agent mode requires an active tab.');
  }

  /** @type {(() => void) | null} */
  let closeBrowserToolSession = null;
  /** @type {AbortController | null} */
  let ac = null;

  try {
    const resolved = await resolveChatRequestContext(
      selectedModel,
      uiFeatures,
      selectedToolIds,
      useKnowledge,
      enabledKnowledgeIds,
    );
    const { modelItem, fcMode, toolIds, knowledgeFiles, features, variables, filterIds } = resolved;
    const mergedFiles = mergeKnowledgeFilesIntoAttachments(filesWithPage, knowledgeFiles);
    // Images never go into the completions `files` field (that's for
    // RAG/citation files) — they only ride along in the persisted message's
    // `files[]` so both the extension and the OWUI web app can render them
    // as real thumbnails after a reload, exactly like natively-uploaded images.
    const persistedFiles = [...mergedFiles, ...imageAttachmentsForPersist];

    ac = newAbortController(tabId);

    let sessionId = null;
    try {
      sessionId = await socketService.waitUntilConnected();
    } catch (e) {
      console.warn('[Neura] socket unavailable for chat; continuing without session_id', e);
    }
    // Whether tool calls are negotiated natively or through the prompt-based
    // fallback is a per-model setting on Open WebUI: honour it, never override it.
    const useNativeFunctionCalling = fcMode === 'native';

    let remoteId = null;
    if (activeChatId) {
      remoteId = await ensureRemoteChat(
        activeChatId,
        chatTitle,
        selectedModel,
        Array.isArray(remoteHistory) ? remoteHistory : [],
      );
    }

    const parentId =
      branchParentId !== null && branchParentId !== undefined
        ? branchParentId
        : remoteHistory.length > 0
          ? remoteHistory[remoteHistory.length - 1].id
          : null;

    const userMessagePayload = userMessageId
      ? {
          id: userMessageId,
          // OWUI Messages.svelte: missing parentId (undefined) ≠ null → infinite Loading.
          parentId: parentId ?? null,
          childrenIds: [assistantMessageId],
          role: 'user',
          content: messageContent,
          // Unix seconds — matches OWUI web client.
          timestamp: Math.floor(Date.now() / 1000),
          models: [selectedModel],
          files: persistedFiles.length > 0 ? persistedFiles : undefined,
          attachment_ids: [],
        }
      : null;

    const serverCaps = await getServerCapabilities();

    // Given `chat_id` and `parent_id`, Open WebUI rebuilds the conversation from
    // its own database (`load_messages_from_db`, since 0.7.0), so resending it
    // would be redundant. Older servers have no such path: there the full history
    // must travel with the request or the model sees only the system prompt.
    const systemOnlyMessages = messages.filter((m) => m.role === 'system');
    const completionMessages =
      remoteId && serverCaps.loadsHistoryFromDb !== false ? systemOnlyMessages : messages;

    let chatContext = null;
    let owuiChatId = null;
    if (remoteId && userMessagePayload) {
      owuiChatId = remoteId;
      chatContext = {
        chatId: remoteId,
        parentId,
        userMessage: userMessagePayload,
        assistantMessageId,
      };
    } else {
      // Ephemeral turn: the server needs a chat id to register a task and emit
      // lifecycle events, and it reads the suffix as our live socket session id.
      owuiChatId = createTemporaryChatId(sessionId);
      if (!owuiChatId) {
        console.warn(
          '[Neura] no socket session: sending without chat_id (server falls back to its ' +
            'synchronous path, so there is no task registration and no cancellation)',
        );
      }
    }

    // Agent mode's extra: the browser tools are offered to the model as a direct
    // tool server, so Open WebUI keeps running the turn (workspace, MCP,
    // built-ins) and only hands back the calls that must happen in this browser.
    // Requires `session_id` — that is the channel the server calls back on.
    const toolServers = [];
    if (agentMode && sessionId && owuiChatId) {
      toolServers.push(buildBrowserToolServer());
      closeBrowserToolSession = openBrowserToolSession({
        chatId: owuiChatId,
        messageId: assistantMessageId,
        tabId,
        broadcast,
      });
    } else if (agentMode) {
      dwarn('api', 'agent mode without a realtime session: browser tools unavailable', {
        hasSession: !!sessionId,
        hasChatId: !!owuiChatId,
      });
    }

    const requestData = buildChatCompletionPayload({
      model: selectedModel,
      modelItem,
      messages: completionMessages,
      mode: agentMode ? 'agent' : 'chat',
      toolIds,
      toolServers,
      features,
      filterIds,
      files: mergedFiles,
      variables,
      sessionId,
      chatId: owuiChatId,
      chatContext,
      assistantMessageId,
      nativeFunctionCalling: useNativeFunctionCalling,
      backgroundTasks: {
        title_generation: true,
        tags_generation: true,
        follow_up_generation: true,
      },
    });

    const { API_ENDPOINT } = await getEndpoints();
    const notify = createTurnNotifier(tabId, activeChatId);

    let partialContent = '';
    let result;
    try {
      result = await streamChatCompletion({
        endpoint: API_ENDPOINT,
        body: requestData,
        signal: ac.signal,
        forwardContentChunks: true,
        forwardStatus: true,
        broadcast,
        notify,
        onTaskIds: ({ taskIds, chatId }) => {
          if (turn) turnState.setServerTask(turn, { owuiChatId: chatId, taskIds });
        },
        onPartial: (chunk) => {
          partialContent += chunk;
        },
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        if (turn) turnState.endTurn(turn, 'aborted', { finalText: partialContent });
        broadcast({ type: 'aborted', content: partialContent });
        return {
          type: 'text',
          message: { role: 'assistant', content: partialContent || '[Generation stopped by user]' },
        };
      }
      throw error;
    }

    let fullContent = result.fullContent || partialContent || '';

    // OWUI builtin image tools arrive as native tool_calls on the SSE stream.
    // With session_id present the server does not execute them — the client must.
    let imageToolCalls = (result.toolCalls || []).filter((tc) =>
      OWUI_IMAGE_TOOL_NAMES.has(tc?.function?.name),
    );
    if (turnImages.length > 0) {
      const editCalls = imageToolCalls.filter((tc) => tc?.function?.name === 'edit_image');
      if (editCalls.length > 0) imageToolCalls = editCalls;
    }

    if (imageToolCalls.length > 0) {
      broadcast({
        type: 'status',
        description: 'Generating image…',
        done: false,
        hidden: false,
      });

      /** @type {object[]} */
      let fileItems = [];
      /** @type {{ callId: string, name: string, content: string }[]} */
      let toolResults = [];

      const exec = await executeOwUiImageToolCalls(imageToolCalls, {
        fallbackImageRefs: turnImages,
      });
      fileItems = exec.fileItems;
      toolResults = exec.toolResults;

      if (fileItems.length > 0) {
        broadcast({ type: 'files', items: fileItems });
        result.hadFiles = true;
      }
      broadcast({
        type: 'status',
        description: fileItems.length > 0 ? 'Image ready' : 'Image generation failed',
        done: true,
        hidden: false,
      });

      const successfulToolResults = toolResults.filter((tr) => {
        try {
          const parsed = JSON.parse(tr.content || '{}');
          return parsed.status === 'success' && !parsed.error;
        } catch {
          return false;
        }
      });

      if (fileItems.length > 0 && successfulToolResults.length > 0) {
        const callsForFollowUp = imageToolCalls.slice(0, successfulToolResults.length);

        const working = [...messages];
        working.push({
          role: 'assistant',
          content: null,
          tool_calls: callsForFollowUp.map((tc, i) => ({
            id: tc.id || successfulToolResults[i]?.callId || `img_call_${i}`,
            type: 'function',
            function: {
              name: tc.function?.name || '',
              arguments:
                typeof tc.function?.arguments === 'string'
                  ? tc.function.arguments
                  : JSON.stringify(tc.function?.arguments || {}),
            },
          })),
        });
        for (const tr of successfulToolResults) {
          working.push({
            role: 'tool',
            tool_call_id: tr.callId,
            content: tr.content,
          });
        }

        const followUpId = crypto.randomUUID();
        const followUpBody = buildChatCompletionPayload({
          model: selectedModel,
          modelItem,
          messages: working,
          mode: 'chat',
          toolIds: [],
          features: {
            ...features,
            image_generation: false,
            code_interpreter: false,
          },
          filterIds,
          files: mergedFiles,
          variables,
          sessionId,
          chatId: owuiChatId,
          assistantMessageId: followUpId,
          nativeFunctionCalling: false,
        });
        try {
          const followUp = await streamChatCompletion({
            endpoint: API_ENDPOINT,
            body: followUpBody,
            signal: ac.signal,
            forwardContentChunks: true,
            forwardStatus: true,
            broadcast,
            onPartial: (chunk) => {
              partialContent += chunk;
            },
          });
          if (followUp.fullContent) {
            fullContent = followUp.fullContent;
          }
          if (followUp.hadFiles) result.hadFiles = true;
        } catch (followErr) {
          if (followErr.name === 'AbortError') {
            if (turn) turnState.endTurn(turn, 'aborted', { finalText: fullContent || partialContent });
            broadcast({ type: 'aborted', content: fullContent || partialContent });
            return {
              type: 'text',
              message: {
                role: 'assistant',
                content: fullContent || partialContent || '[Generation stopped by user]',
              },
            };
          }
          console.warn('[Neura] image-gen follow-up failed', followErr);
        }
      } else if (toolResults.length > 0 && fileItems.length === 0) {
        const errParts = toolResults
          .map((tr) => {
            try {
              const parsed = JSON.parse(tr.content || '{}');
              return parsed.error || '';
            } catch {
              return tr.content || '';
            }
          })
          .filter(Boolean);
        const errMsg = errParts[0] || 'Image edit failed';
        broadcast({ type: 'stream_error', message: errMsg });
      }
    }

    if (!fullContent.trim() && result.hadToolExecution && !result.hadFiles && !result.hadSources) {
      console.warn('[Neura] hadToolExecution but empty content (no invented user message)', {
        toolCalls: (result.toolCalls || []).map((tc) => tc?.function?.name),
        outputItemTypes: (result.outputItems || []).map((o) => o?.type),
        finishReason: result.finishReason,
        streamError: result.streamError,
        toolIdsCount: toolIds.length,
        hadFiles: !!result.hadFiles,
      });
    }

    let hasRenderableResult =
      !!fullContent.trim() ||
      !!result.hadToolExecution ||
      !!result.hadSources ||
      !!result.hadFiles;

    if (!hasRenderableResult) {
      if (turn) turnState.endTurn(turn, 'error');
      if (result.streamError) throw new Error(result.streamError);
      throw new Error('No content received from streaming response');
    }

    if (turn) turnState.endTurn(turn, 'done', { finalText: fullContent });

    broadcast({
      type: 'done',
      content: fullContent,
      reasoning: result.fullReasoning || '',
      outputItems: result.outputItems || [],
    });

    // From Open WebUI 0.9.0 the completions endpoint persists the whole turn
    // itself — user message, assistant placeholder, content, `output`, sources,
    // follow-ups and usage. Writing the chat from here would overwrite all of
    // that with the client's poorer view of the message: the server's history
    // merge works per message id, so a payload without those fields still wipes
    // them. Older servers (<= 0.8.12) persist nothing during a completion, so
    // there the write is what keeps the conversation.
    if (activeChatId && remoteId && userMessagePayload && serverCaps.persistsTurns !== true) {
      await pushTurnToServer({
        localChatId: activeChatId,
        title: chatTitle,
        model: selectedModel,
        modelItem,
        priorMessages: Array.isArray(remoteHistory) ? remoteHistory : [],
        userMessage: userMessagePayload,
        assistantMessage: {
          id: assistantMessageId,
          role: 'assistant',
          content: fullContent,
          timestamp: Math.floor(Date.now() / 1000),
          model: selectedModel,
          modelName: selectedModel,
          modelIdx: 0,
          done: true,
        },
        sessionId,
        filterIds,
      });
    }

    return {
      type: 'text',
      message: { role: 'assistant', content: fullContent },
    };
  } catch (error) {
    console.error('Error communicating with Neura OpenWebUI:', error);
    if (turn) turnState.endTurn(turn, 'error');
    throw new Error(
      error.message || 'Communication error with Neura. Please check your connection and try again.',
    );
  } finally {
    if (closeBrowserToolSession) closeBrowserToolSession();
    // The turn is over: leaving its controller registered would make a later Stop
    // report that it cancelled something.
    if (ac) releaseAbortController(tabId, ac);
  }
}

export async function fetchAvailableModels() {
  await ensureAuthenticated();
  const { MODELS_ENDPOINT } = await getEndpoints();
  const response = await apiFetch(MODELS_ENDPOINT, { method: 'GET' });
  if (response.ok) return response.json();
  throw new Error('Failed to fetch models');
}
