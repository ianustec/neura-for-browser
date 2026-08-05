import { dlog } from './debug-log.js';

/**
 * Central factory for POST /api/chat/completions body (SPEC §2.2).
 */

/**
 * @param {object} opts
 * @param {string} opts.model
 * @param {object} [opts.modelItem]
 * @param {object[]} opts.messages
 * @param {'chat'|'agent'} opts.mode Diagnostics only: both build the same request.
 * @param {string[]} [opts.toolIds]
 * @param {object[]} [opts.tools] Rarely needed: sending this makes Open WebUI skip
 *   its own tool resolution, so browser tools use `toolServers` instead.
 * @param {object} [opts.features]
 * @param {object} [opts.chatContext]
 * @param {string} [opts.chatId] OWUI chat id. Use `temporary:<socket session id>`
 *   (see owui-chat-id.js) for ephemeral turns: it enables the server-side tool loop,
 *   task registration and chat-scoped cancellation without DB persistence.
 * @param {string} [opts.sessionId]
 * @param {string} [opts.assistantMessageId]
 * @param {string[]} [opts.filterIds]
 * @param {object[]} [opts.files]
 * @param {object} [opts.variables]
 * @param {object} [opts.backgroundTasks]
 * @param {boolean} [opts.nativeFunctionCalling]
 * @param {object[]} [opts.toolServers] Direct tool servers (SPEC §2.2 tool_servers):
 *   tools the server delegates back to this client over the socket.
 * @returns {object}
 */
export function buildChatCompletionPayload(opts) {
  const {
    model,
    modelItem = null,
    messages,
    mode,
    toolIds = [],
    tools = [],
    features = {},
    chatContext = null,
    chatId = null,
    sessionId = null,
    assistantMessageId = null,
    filterIds = [],
    files = [],
    variables = {},
    backgroundTasks = null,
    nativeFunctionCalling = false,
    toolServers = [],
  } = opts;

  /** @type {Record<string, unknown>} */
  const payload = {
    stream: true,
    model,
    messages: messages || [],
    tool_servers: toolServers || [],
  };

  if (nativeFunctionCalling) {
    payload.params = { function_calling: 'native' };
    payload.stream_options = { include_usage: true };
  }

  if (modelItem) {
    payload.model_item = modelItem;
  }

  // Agent mode is the same request as a normal chat: `tool_ids` let Open WebUI
  // resolve and run workspace/MCP and built-in tools itself. Its extra —
  // browser automation — travels in `tool_servers` (see browser-tool-bridge.js),
  // never in `tools`: an explicit `tools` array makes the server skip tool_ids
  // resolution entirely, which is what used to leave agent turns without MCP.
  if (toolIds.length > 0) {
    payload.tool_ids = toolIds;
  }
  payload.features = {
    voice: !!features.voice,
    web_search: !!features.web_search,
    image_generation: !!features.image_generation,
    code_interpreter: !!features.code_interpreter,
    memory: !!features.memory,
  };
  if (tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  if (filterIds.length > 0) {
    payload.filter_ids = filterIds;
  }

  if (files.length > 0) {
    payload.files = files;
    dlog('chat-payload', 'attaching files[] to completions', {
      mode,
      count: files.length,
      files: files.map((f) => ({
        id: f?.id,
        type: f?.type,
        name: f?.name,
        context: f?.context,
        sourceUrl: f?.sourceUrl,
        collection_name: f?.collection_name,
      })),
    });
  }

  if (variables && Object.keys(variables).length > 0) {
    payload.variables = variables;
  }

  if (sessionId) {
    payload.session_id = sessionId;
  }

  if (assistantMessageId) {
    payload.id = assistantMessageId;
  }

  // Conduit always sends background_tasks; image_generation here helps the
  // server run the feature path even without a persisted chat_id.
  const bg =
    backgroundTasks && typeof backgroundTasks === 'object'
      ? { ...backgroundTasks }
      : {};
  if (features.image_generation) bg.image_generation = true;
  if (features.web_search) bg.web_search = true;
  if (Object.keys(bg).length > 0) {
    payload.background_tasks = bg;
  }

  const resolvedChatId = chatContext?.chatId || chatId || null;
  if (resolvedChatId) {
    payload.chat_id = resolvedChatId;
  }

  if (chatContext?.chatId) {
    if (!assistantMessageId && chatContext.assistantMessageId) {
      payload.id = chatContext.assistantMessageId;
    }
    // Always explicit: Open WebUI reads `parent_id` to place the user message in
    // the history tree, and its absence marks the request as unmanaged.
    payload.parent_id = chatContext.parentId ?? null;
    if (chatContext.userMessage) {
      payload.user_message = chatContext.userMessage;
    }
  }

  return payload;
}

/**
 * Build template variables for OWUI from user profile.
 * @param {object|null} user
 * @returns {Record<string, string>}
 */
export function buildTemplateVariables(user) {
  const name = user?.name || user?.username || user?.email || 'User';
  return {
    '{{USER_NAME}}': name,
    '{{CURRENT_DATETIME}}': new Date().toISOString(),
  };
}

/**
 * Extract default feature toggles from model detail.
 * @param {object|null} modelItem
 * @returns {{ web_search: boolean, image_generation: boolean, code_interpreter: boolean, memory: boolean }}
 */
export function extractDefaultFeatures(modelItem) {
  const defaults = {
    web_search: false,
    image_generation: false,
    code_interpreter: false,
    memory: false,
  };
  if (!modelItem) return defaults;

  const ids =
    modelItem.meta?.defaultFeatureIds ||
    modelItem.info?.meta?.defaultFeatureIds ||
    [];
  for (const id of ids) {
    if (id in defaults) defaults[id] = true;
  }
  return defaults;
}

/**
 * Extract filter ids from model detail.
 * @param {object|null} modelItem
 * @returns {string[]}
 */
export function extractFilterIds(modelItem) {
  if (!modelItem) return [];
  const filters = modelItem.meta?.filters || modelItem.info?.meta?.filters || [];
  return filters.map((f) => f?.id).filter(Boolean);
}
