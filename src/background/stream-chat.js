/**
 * Merge streaming tool_call deltas (OpenAI format).
 * @param {Map<number, { id: string, type: string, function: { name: string, arguments: string } }>} acc
 * @param {object} delta
 */
export function mergeToolCallDelta(acc, delta) {
  if (!delta?.tool_calls) return;
  for (const tc of delta.tool_calls) {
    let idx = typeof tc.index === 'number' ? tc.index : 0;

    if (tc.id) {
      for (const [k, entry] of acc.entries()) {
        if (entry?.id === tc.id) {
          idx = k;
          break;
        }
      }
      const existing = acc.get(idx);
      if (existing?.id && existing.id !== tc.id) {
        idx = acc.size > 0 ? Math.max(...acc.keys()) + 1 : 0;
        while (acc.has(idx)) idx += 1;
      }
    }

    let cur = acc.get(idx);
    if (!cur) {
      cur = { id: '', type: 'function', function: { name: '', arguments: '' } };
      acc.set(idx, cur);
    }
    if (tc.id) cur.id = tc.id;
    if (tc.type) cur.type = tc.type;
    if (tc.function?.name) cur.function.name += tc.function.name;
    if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
  }
}

export function finalizeToolCalls(acc) {
  const keys = [...acc.keys()].sort((a, b) => a - b);
  return keys.map((k) => acc.get(k)).filter(Boolean);
}

/** @param {object | null | undefined} delta */
export function extractReasoningDelta(delta) {
  if (!delta || typeof delta !== 'object') return '';
  for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
    const text = normalizeStreamText(delta[key]);
    if (text) return text;
  }
  return '';
}

/** @param {object | null | undefined} choice */
export function extractReasoningFromChoice(choice) {
  if (!choice || typeof choice !== 'object') return '';
  const fromDelta = extractReasoningDelta(choice.delta);
  if (fromDelta) return fromDelta;
  const fromMessage = extractReasoningDelta(choice.message);
  if (fromMessage) return fromMessage;
  const fromMessageField = normalizeStreamText(choice.message?.reasoning_content);
  if (fromMessageField) return fromMessageField;
  return '';
}

/**
 * @param {object} payload
 * @param {{ broadcast?: (ev:object)=>void, port?: chrome.runtime.Port|null }} sink
 * @param {object} state
 */
function ingestStandaloneReasoningFields(payload, sink, state) {
  if (!payload || typeof payload !== 'object') return;
  const standalone = normalizeStreamText(
    payload.reasoning_content ?? payload.reasoning ?? payload.thinking,
  );
  if (standalone) appendOrDiffReasoning(state, sink, standalone);
}

/**
 * Normalize stream text from string, multimodal array, or { text } parts.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeStreamText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    let out = '';
    for (const part of value) {
      out += normalizeStreamText(part);
    }
    return out;
  }
  if (typeof value === 'object') {
    const o = /** @type {Record<string, unknown>} */ (value);
    if (typeof o.text === 'string') return o.text;
    if (typeof o.content === 'string') return o.content;
  }
  return '';
}

/**
 * Visible text of an assistant message as Open WebUI derives it from
 * Responses-API `output` items: only `message` items contribute to the answer
 * (mirrors the server's get_output_text and the web client's getOutputText).
 * Tool results live in `function_call_output` items and are rendered as steps,
 * never merged into the message body.
 * @param {object[] | null | undefined} output
 * @returns {string}
 */
export function extractOutputText(output) {
  if (!Array.isArray(output) || output.length === 0) return '';
  const parts = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    if (String(item.type || '') !== 'message') continue;
    const text = normalizeStreamText(item.content ?? item.text).trim();
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

/**
 * Unwrap OWUI envelopes where completion fields live under `data`.
 * @param {object} payload
 * @returns {object}
 */
function resolveCompletionPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const type = payload.type?.toString?.() || '';
  const data = payload.data;
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    (type === 'chat:completion' ||
      type === 'message' ||
      (payload.choices == null &&
        payload.content == null &&
        (data.content != null || data.choices != null || data.output != null)))
  ) {
    return {
      ...data,
      ...(Array.isArray(payload.choices) ? { choices: payload.choices } : {}),
    };
  }
  return payload;
}

const MESSAGE_CONTENT_REPLACE_TYPES = new Set(['chat:message', 'replace']);
const MESSAGE_CONTENT_DELTA_TYPES = new Set(['chat:message:delta', 'message']);

/**
 * Ingest OWUI chat:message:delta / chat:message / message / replace socket/SSE events.
 * @param {string} eventType
 * @param {object | null | undefined} payload
 * @param {{ broadcast?: (ev:object)=>void, port?: chrome.runtime.Port|null, forwardContentChunks?: boolean, onPartial?: (s:string)=>void }} sink
 * @param {object} state
 * @returns {boolean}
 */
export function ingestMessageContentEvent(eventType, payload, sink, state) {
  const type = String(eventType || '');
  if (!MESSAGE_CONTENT_REPLACE_TYPES.has(type) && !MESSAGE_CONTENT_DELTA_TYPES.has(type)) {
    return false;
  }
  if (!payload || typeof payload !== 'object') return true;

  const body = resolveCompletionPayload(payload);
  ingestStandaloneReasoningFields(body, sink, state);
  const choice = body.choices?.[0];
  if (choice) ingestChoiceContent(choice, sink, state);

  const text = normalizeStreamText(body.content);
  if (!text) return true;

  const mode = MESSAGE_CONTENT_REPLACE_TYPES.has(type) ? 'replace' : 'append';
  appendOrReplaceContent(state, sink, text, { mode });
  state.sawMessageContent = true;
  return true;
}

/** @type {string} */
let owuiBaseUrl = '';

/**
 * Cache Open WebUI origin for resolving relative file/image URLs during a stream.
 * @param {string} baseUrl
 */
export function setOwUiBaseUrl(baseUrl) {
  owuiBaseUrl = String(baseUrl || '').replace(/\/$/, '');
}

/**
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function resolveOwUiUrl(url) {
  if (!url || typeof url !== 'string') return url || '';
  if (
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    /^https?:\/\//i.test(url) ||
    url.startsWith('//')
  ) {
    return url;
  }
  if (url.startsWith('/') && owuiBaseUrl) {
    return `${owuiBaseUrl}${url}`;
  }
  return url;
}

/** Image extensions recognized when content_type/type are unavailable (mirrors messages.js). */
const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i;
/** Extensions with a filename that unambiguously identify a non-image document. */
const NON_IMAGE_EXTENSION_RE = /\.[a-z0-9]{2,5}$/i;

/**
 * @param {string} [url]
 * @param {string} [name]
 * @returns {boolean}
 */
function looksLikeImageByExtension(url, name) {
  return IMAGE_EXTENSION_RE.test(String(url || '')) || IMAGE_EXTENSION_RE.test(String(name || ''));
}

/**
 * A filename with a non-image extension (e.g. `.docx`) is a definitive "not an image" signal.
 * Used only where the historical default was `image` (bare b64 payloads) to avoid regressing
 * legacy OpenAI-style image generation, which never sets a filename.
 * @param {string} [name]
 * @returns {boolean}
 */
function looksLikeNonImageByFilename(name) {
  const n = String(name || '');
  return NON_IMAGE_EXTENSION_RE.test(n) && !IMAGE_EXTENSION_RE.test(n);
}

/**
 * @param {object} item
 * @returns {object}
 */
function normalizeOneFileItem(item) {
  if (!item || typeof item !== 'object') return item;
  const raw =
    item.url ||
    item.href ||
    item.path ||
    (item.file && (item.file.url || item.file.id)) ||
    item.id ||
    '';
  const url = typeof raw === 'string' ? resolveOwUiUrl(raw) : '';
  const contentType =
    item.content_type ||
    item.contentType ||
    (item.file && (item.file.content_type || item.file.contentType)) ||
    '';
  const name = item.filename || item.title || (item.file && item.file.name) || item.name || '';
  let type;
  if (item.type === 'image' || (typeof contentType === 'string' && contentType.startsWith('image/'))) {
    type = 'image';
  } else if (item.type) {
    type = item.type;
  } else if (contentType) {
    // A known non-image content_type is a definitive signal — never guessed as image.
    type = 'file';
  } else if (looksLikeImageByExtension(url, name)) {
    type = 'image';
  } else {
    type = 'file';
  }
  const out = { ...item, type };
  if (url) out.url = url;
  if (contentType) out.content_type = contentType;
  if (!out.name && name) out.name = name;
  return out;
}

/**
 * @param {object[]} items
 * @returns {object[]}
 */
export function normalizeFileItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((f) => normalizeOneFileItem(f));
}

/**
 * Deduplicate file items by URL (Conduit _mergeNormalizedFiles style).
 * @param {object[]} items
 * @returns {object[]}
 */
export function dedupeFileItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const key = item.url || item.id || JSON.stringify(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Merge file items into stream state (deduped) and mark hadFiles.
 * @param {object} [state]
 * @param {object[]} items
 */
function accumulateFileItems(state, items) {
  if (!state || !Array.isArray(items) || items.length === 0) return;
  if (!Array.isArray(state.fileItems)) state.fileItems = [];
  state.fileItems = dedupeFileItems([...state.fileItems, ...items]);
  state.hadFiles = true;
}

/**
 * Port of Conduit `_extractFilesFromResult` — normalizes image gen / tool file payloads.
 * @param {unknown} resp
 * @returns {object[]}
 */
export function extractFilesFromResult(resp) {
  /** @type {object[]} */
  const results = [];
  if (resp == null) return results;

  let r = resp;
  if (typeof r === 'string') {
    const trimmed = r.trim();
    if (!trimmed) return results;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        r = JSON.parse(trimmed);
      } catch {
        results.push({ type: 'image', url: resolveOwUiUrl(trimmed) });
        return results;
      }
    } else {
      results.push({ type: 'image', url: resolveOwUiUrl(trimmed) });
      return results;
    }
  }

  if (Array.isArray(r)) {
    for (const item of r) {
      if (typeof item === 'string' && item) {
        results.push({ type: 'image', url: resolveOwUiUrl(item) });
      } else if (item && typeof item === 'object') {
        const url = item.url || item.href || item.path || item.id;
        const b64 = item.b64_json || item.b64;
        if (typeof url === 'string' && url) {
          results.push(normalizeOneFileItem({ ...item, url }));
        } else if (typeof b64 === 'string' && b64) {
          const b64Name = item.name || item.filename;
          results.push(
            looksLikeNonImageByFilename(b64Name)
              ? { type: 'file', url: `data:application/octet-stream;base64,${b64}`, name: b64Name }
              : {
                  type: 'image',
                  url: b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`,
                  name: b64Name,
                },
          );
        }
      }
    }
    return dedupeFileItems(results);
  }

  if (!r || typeof r !== 'object') return results;

  const data = r.data;
  if (Array.isArray(data)) {
    results.push(...extractFilesFromResult(data));
  }

  const images = r.images;
  if (Array.isArray(images)) {
    results.push(...extractFilesFromResult(images));
  }

  const files = r.files;
  if (Array.isArray(files)) {
    results.push(...extractFilesFromResult(files));
  }

  // Envelope: { data: { files: [...] } }
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.files)) {
    results.push(...extractFilesFromResult(data.files));
  }

  const singleUrl = r.url;
  if (typeof singleUrl === 'string' && singleUrl) {
    results.push(normalizeOneFileItem({ ...r, url: singleUrl }));
  }

  const singleB64 = r.b64_json || r.b64;
  if (typeof singleB64 === 'string' && singleB64) {
    const b64Name = r.name || r.filename;
    results.push(
      looksLikeNonImageByFilename(b64Name)
        ? { type: 'file', url: `data:application/octet-stream;base64,${singleB64}`, name: b64Name }
        : {
            type: 'image',
            url: singleB64.startsWith('data:') ? singleB64 : `data:image/png;base64,${singleB64}`,
            name: b64Name,
          },
    );
  }

  return dedupeFileItems(normalizeFileItems(results));
}

/**
 * Extract file items from an OWUI files / chat:message:files / tool envelope.
 * @param {object} parsed
 * @returns {object[]}
 */
export function extractFileItems(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed.data?.files)) return extractFilesFromResult(parsed.data.files);
  if (Array.isArray(parsed.files)) return extractFilesFromResult(parsed.files);
  if (parsed.data != null) {
    const fromData = extractFilesFromResult(parsed.data);
    if (fromData.length) return fromData;
  }
  return extractFilesFromResult(parsed);
}

/**
 * @param {object} parsed
 * @param {{ broadcast?: (ev:object)=>void, port?: chrome.runtime.Port|null }} sink
 * @param {object} [state] optional stream state — sets hadFiles when files are forwarded
 * @returns {boolean}
 */
export function forwardOwUiEvent(parsed, sink, state) {
  if (!parsed || typeof parsed !== 'object') return false;
  const send = (ev) => {
    if (typeof sink?.broadcast === 'function') sink.broadcast(ev);
    else if (sink?.port) sink.port.postMessage(ev);
  };

  const eventType = parsed.type;

  if ((eventType === 'status' || eventType === 'event:status') && (parsed.data || parsed)) {
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    send({
      type: 'status',
      description: data.description || data.action || '',
      done: !!data.done,
      hidden: !!data.hidden,
    });
    return true;
  }

  if (eventType === 'source' || eventType === 'sources') {
    const items =
      (Array.isArray(parsed.data?.sources) && parsed.data.sources) ||
      (Array.isArray(parsed.data) && parsed.data) ||
      (Array.isArray(parsed.sources) && parsed.sources) ||
      [];
    if (items.length > 0) {
      send({ type: 'sources', items });
      if (state) state.hadSources = true;
    }
    return true;
  }

  if (eventType === 'citation') {
    send({ type: 'citation', data: parsed.data || parsed });
    return true;
  }

  // generate_image / edit_image emit chat:message:files; tool results may use event:tool
  if (
    eventType === 'files' ||
    eventType === 'chat:message:files' ||
    eventType === 'event:tool' ||
    eventType === 'execute:tool' ||
    Array.isArray(parsed.files)
  ) {
    const fromFiles = extractFileItems(parsed);
    const fromResult =
      parsed.result != null
        ? extractFilesFromResult(parsed.result)
        : parsed.data?.result != null
          ? extractFilesFromResult(parsed.data.result)
          : [];
    const items = dedupeFileItems([...fromFiles, ...fromResult]);
    if (items.length > 0) {
      send({ type: 'files', items });
      accumulateFileItems(state, items);
    }
    // execute:tool / event:tool count as tool execution even without files
    if (
      (eventType === 'event:tool' || eventType === 'execute:tool') &&
      state &&
      !state.hadToolExecution
    ) {
      state.hadToolExecution = true;
    }
    return true;
  }

  if (eventType === 'chat:completion' || eventType === 'message:actions') {
    const actions = parsed.data?.actions || parsed.actions;
    if (Array.isArray(actions) && actions.length > 0) {
      send({ type: 'actions', items: actions });
      return true;
    }
  }

  return false;
}

/**
 * SSE frame parser with persistent buffer (frames delimited by blank line).
 * @param {(parsed: object) => void} onFrame
 */
export function createSseFrameParser(onFrame) {
  let buffer = '';
  let done = false;

  const processFrame = (frame) => {
    const lines = frame.split('\n');
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith(':')) continue;
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload.trim() === '[DONE]') {
        done = true;
        return;
      }
      dataLines.push(payload);
    }
    if (dataLines.length === 0) return;
    const joined = dataLines.join('\n').trim();
    if (joined === '[DONE]') {
      done = true;
      return;
    }
    try {
      onFrame(JSON.parse(joined));
    } catch {
      /* ignore malformed JSON */
    }
  };

  return {
    feed(chunk) {
      if (done) return;
      buffer += chunk;
      while (!done) {
        const sep = buffer.indexOf('\n\n');
        if (sep === -1) break;
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        processFrame(frame);
      }
    },
    flush() {
      if (done || !buffer.trim()) return;
      processFrame(buffer);
      buffer = '';
    },
    isDone() {
      return done;
    },
  };
}

/**
 * @param {object} state
 * @param {{ broadcast?: (ev:object)=>void, port?: chrome.runtime.Port|null, forwardContentChunks?: boolean, onPartial?: (s:string)=>void }} sink
 * @param {string} nextText
 * @param {{ mode: 'append' | 'replace' }} opts
 */
export function appendOrReplaceContent(state, sink, nextText, { mode }) {
  if (typeof nextText !== 'string' || nextText.length === 0) return;

  const send = (ev) => {
    if (typeof sink?.broadcast === 'function') sink.broadcast(ev);
    else if (sink?.port) sink.port.postMessage(ev);
  };

  let piece = '';
  if (mode === 'append') {
    // Some providers send cumulative snapshots in delta.content; treat like replace.
    if (nextText.startsWith(state.fullContent)) {
      piece = nextText.slice(state.fullContent.length);
      state.fullContent = nextText;
    } else if (
      state.fullContent.startsWith(nextText) &&
      nextText.length < state.fullContent.length
    ) {
      return;
    } else {
      piece = nextText;
      state.fullContent += nextText;
    }
  } else {
    // Cumulative / full message.content: emit only the new suffix when possible.
    if (nextText.startsWith(state.fullContent)) {
      piece = nextText.slice(state.fullContent.length);
      state.fullContent = nextText;
    } else if (state.fullContent.startsWith(nextText) && nextText.length < state.fullContent.length) {
      // Shorter snapshot — ignore (stale).
      return;
    } else {
      // New turn after tools (non-prefix). Reset UI instead of appending.
      state.fullContent = nextText;
      if (typeof sink?.onPartial === 'function') sink.onPartial(nextText);
      if (sink?.forwardContentChunks !== false) {
        send({ type: 'content_reset', content: nextText });
      }
      return;
    }
  }

  if (!piece) return;
  if (typeof sink?.onPartial === 'function') sink.onPartial(piece);
  if (sink?.forwardContentChunks !== false) {
    send({ type: 'chunk', content: piece });
  }
}

/**
 * Some providers stream `reasoning_content`/`reasoning`/`thinking` as true
 * incremental deltas; others resend the full cumulative reasoning text on
 * every chunk. Treating the latter as a delta (i.e. always appending it
 * verbatim) makes the UI reprint the whole prior reasoning on every event —
 * a cascading, ever-growing duplicate wall of text. Detect which case we're
 * in per-event and always forward only the genuinely new piece.
 * @param {object} state
 * @param {{ broadcast?: (ev:object)=>void, port?: chrome.runtime.Port|null }} sink
 * @param {string} nextText
 */
export function appendOrDiffReasoning(state, sink, nextText) {
  if (typeof nextText !== 'string' || nextText.length === 0) return;

  const send = (ev) => {
    if (typeof sink?.broadcast === 'function') sink.broadcast(ev);
    else if (sink?.port) sink.port.postMessage(ev);
  };

  const prev = state.fullReasoning || '';
  let piece;
  if (nextText.startsWith(prev)) {
    // Cumulative snapshot (or first chunk, prev === ''): forward only the new suffix.
    piece = nextText.slice(prev.length);
    state.fullReasoning = nextText;
  } else if (prev.startsWith(nextText) && nextText.length < prev.length) {
    // Shorter snapshot than what we already have — stale, ignore.
    return;
  } else {
    // Genuine incremental delta (does not extend the previous cumulative text).
    piece = nextText;
    state.fullReasoning = prev + nextText;
  }

  if (!piece) return;
  send({ type: 'reasoning', content: piece });
}

/**
 * @param {object[] | null | undefined} output
 * @param {{ broadcast?: (ev:object)=>void, port?: chrome.runtime.Port|null }} sink
 * @param {object} state
 */
const MAX_TOOL_OUTPUT_UI = 12000;

function extractToolOutputText(item) {
  if (!item || typeof item !== 'object') return '';
  const parts = Array.isArray(item.output) ? item.output : [];
  return parts
    .filter((part) => part?.type !== 'input_image')
    .map((part) => {
      if (part?.text == null) return '';
      return typeof part.text === 'string' ? part.text : String(part.text);
    })
    .join('');
}

function truncateToolOutput(text) {
  const raw = String(text || '');
  if (raw.length <= MAX_TOOL_OUTPUT_UI) return raw;
  return `${raw.slice(0, MAX_TOOL_OUTPUT_UI)}\n…`;
}

export function ingestOutputItems(output, sink, state) {
  if (!Array.isArray(output)) return;
  const send = (ev) => {
    if (typeof sink?.broadcast === 'function') sink.broadcast(ev);
    else if (sink?.port) sink.port.postMessage(ev);
  };

  if (output.length > 0) {
    state.outputItems = output;
    state.sawOutputItems = true;
    send({ type: 'output_steps', items: output });
  }

  if (!state.seenOutputCallIds) state.seenOutputCallIds = new Set();

  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'function_call') {
      state.hadToolExecution = true;
      const callId = item.call_id || item.id || item.name || '';
      if (callId && state.seenOutputCallIds.has(`fc:${callId}`)) continue;
      if (callId) state.seenOutputCallIds.add(`fc:${callId}`);
      send({
        type: 'function_call',
        name: item.name || '',
        arguments: item.arguments || '',
        callId: item.call_id || '',
      });
    } else if (item.type === 'function_call_output') {
      state.hadToolExecution = true;
      const callId = item.call_id || item.id || '';
      if (callId && state.seenOutputCallIds.has(`fco:${callId}`)) continue;
      if (callId) state.seenOutputCallIds.add(`fco:${callId}`);
      send({
        type: 'function_call_output',
        callId: item.call_id || '',
        output: truncateToolOutput(extractToolOutputText(item)),
      });
    } else if (item.type === 'code_interpreter') {
      const callId = item.id || item.call_id || `ci:${state.seenOutputCallIds.size}`;
      if (state.seenOutputCallIds.has(`ci:${callId}`)) continue;
      state.seenOutputCallIds.add(`ci:${callId}`);
      send({
        type: 'code_interpreter',
        code: item.code || '',
        language: item.language || 'python',
        output: item.output || '',
      });
    } else if (item.type === 'message') {
      const text = normalizeStreamText(item.content ?? item.text);
      if (text) {
        state.sawMessageContent = true;
        appendOrReplaceContent(state, sink, text, { mode: 'replace' });
      }
    }
  }
}

/**
 * Ingest OpenAI-style choice (delta and/or full message).
 * @param {object | null | undefined} choice
 * @param {{ broadcast?: (ev:object)=>void, port?: chrome.runtime.Port|null, forwardContentChunks?: boolean, onPartial?: (s:string)=>void }} sink
 * @param {object} state
 */
export function ingestChoiceContent(choice, sink, state) {
  if (!choice || typeof choice !== 'object') return;

  if (choice.finish_reason) {
    state.finishReason = choice.finish_reason;
  }

  const delta = choice.delta;
  if (delta?.tool_calls) {
    mergeToolCallDelta(state.toolAcc, delta);
    state.hadToolExecution = true;
  }
  if (choice.message?.tool_calls) {
    mergeToolCallDelta(state.toolAcc, { tool_calls: choice.message.tool_calls });
    state.hadToolExecution = true;
  }

  const reasoningDelta = extractReasoningFromChoice(choice);
  if (reasoningDelta) {
    appendOrDiffReasoning(state, sink, reasoningDelta);
  }

  const deltaText = normalizeStreamText(delta?.content);
  if (deltaText) {
    appendOrReplaceContent(state, sink, deltaText, { mode: 'append' });
  }

  const messageContent = normalizeStreamText(choice.message?.content);
  if (messageContent.length > 0) {
    state.sawMessageContent = true;
    appendOrReplaceContent(state, sink, messageContent, { mode: 'replace' });
  }
}

/**
 * Ingest completion payload fields shared by SSE frames and socket chat:completion.
 * @param {object} payload
 * @param {{ broadcast?: (ev:object)=>void, port?: chrome.runtime.Port|null, forwardContentChunks?: boolean, onPartial?: (s:string)=>void }} sink
 * @param {object} state
 */
export function ingestCompletionPayload(payload, sink, state) {
  if (!payload || typeof payload !== 'object') return;
  payload = resolveCompletionPayload(payload);

  const send = (ev) => {
    if (typeof sink?.broadcast === 'function') sink.broadcast(ev);
    else if (sink?.port) sink.port.postMessage(ev);
  };

  ingestStandaloneReasoningFields(payload, sink, state);

  if (Array.isArray(payload.output)) {
    ingestOutputItems(payload.output, sink, state);
  }

  if (payload.tool_calls) {
    mergeToolCallDelta(state.toolAcc, { tool_calls: payload.tool_calls });
    state.hadToolExecution = true;
  }

  const choice = payload.choices?.[0];
  if (choice) {
    ingestChoiceContent(choice, sink, state);
  }

  const payloadContent = normalizeStreamText(payload.content);
  if (payloadContent.length > 0) {
    appendOrReplaceContent(state, sink, payloadContent, { mode: 'replace' });
  }

  // Files may ride along on chat:completion (image gen / tool results).
  if (payload.files != null || payload.images != null) {
    const items = dedupeFileItems([
      ...extractFilesFromResult(payload.files),
      ...extractFilesFromResult(payload.images),
    ]);
    if (items.length > 0) {
      send({ type: 'files', items });
      accumulateFileItems(state, items);
    }
  }
}

/**
 * Process a single parsed SSE JSON frame.
 * Does not early-return after output[]/usage so co-located content is not dropped.
 * @returns {{ handled: boolean, meta?: object }}
 */
export function processSseFrame(parsed, sink, state) {
  const send = (ev) => {
    if (typeof sink?.broadcast === 'function') sink.broadcast(ev);
    else if (sink?.port) sink.port.postMessage(ev);
  };

  if (!parsed || typeof parsed !== 'object') {
    return { handled: false };
  }

  if (parsed.error?.message) {
    state.streamError = parsed.error.message;
    send({ type: 'stream_error', message: parsed.error.message });
    return { handled: true };
  }

  let handled = false;

  if (parsed.usage) {
    state.usage = parsed.usage;
    send({ type: 'usage', data: parsed.usage });
    handled = true;
  }

  if (parsed.selected_model_id) {
    send({ type: 'model_selected', modelId: parsed.selected_model_id });
    handled = true;
  }

  if (forwardOwUiEvent(parsed, sink, state)) {
    handled = true;
  }

  if (ingestMessageContentEvent(parsed.type, parsed.data || parsed, sink, state)) {
    handled = true;
  }

  if (Array.isArray(parsed.sources) && parsed.sources.length > 0) {
    state.hadSources = true;
    send({ type: 'sources', items: parsed.sources });
    handled = true;
  }

  if (Array.isArray(parsed.files) && parsed.files.length > 0) {
    const items = extractFilesFromResult(parsed.files);
    send({ type: 'files', items });
    accumulateFileItems(state, items);
    handled = true;
  }

  const beforeContent = state.fullContent || '';
  const hadToolsBefore = !!state.hadToolExecution;
  ingestCompletionPayload(parsed, sink, state);
  if (
    state.hadToolExecution !== hadToolsBefore ||
    (state.fullContent || '') !== beforeContent ||
    Array.isArray(parsed.output) ||
    parsed.choices ||
    typeof parsed.content === 'string'
  ) {
    handled = true;
  }

  return { handled };
}

import { apiFetch } from './api-client.js';
import { getEndpoints } from './constants.js';
import { beginTurn } from './owui-turn-channel.js';

/**
 * Run one completion against Open WebUI.
 *
 * With `session_id` and `chat_id` the server registers a task and delivers
 * everything over Socket.IO, answering the POST with `{task_ids, chat_id}`. The
 * socket consumer is therefore registered *before* the request is sent, so no
 * event can fall into the gap between the HTTP response and the subscription.
 *
 * Servers (or requests) that take the synchronous path answer with an SSE body
 * instead, which carries the whole turn on its own.
 *
 * @param {object} opts
 * @returns {Promise<{ fullContent: string, finishReason: string|null, toolCalls: object[], hadToolExecution: boolean, hadSources: boolean, hadFiles: boolean, fileItems: object[], usage: object|null, streamError: string|null, outputItems: object[] }>}
 */
export async function streamChatCompletion({
  endpoint,
  body,
  port,
  signal,
  forwardContentChunks = true,
  forwardStatus = true,
  onPartial,
  onStatus,
  broadcast,
  notify,
  onTaskIds,
}) {
  try {
    const { BASE_URL } = await getEndpoints();
    setOwUiBaseUrl(BASE_URL);
  } catch {
    /* keep previous cache */
  }

  const sessionIdForSocket = body?.session_id?.toString?.() || '';
  const messageIdForSocket = body?.id?.toString?.() || '';
  const userMessageIdForSocket = body?.user_message?.id?.toString?.() || '';
  const chatIdForSocket = body?.chat_id?.toString?.() || '';

  /** @type {{ promise: Promise<object>, attachTaskIds: (ids: string[]) => void, adoptChatId: (id: string) => void, discard: () => void } | null} */
  let turn = null;
  if (sessionIdForSocket && chatIdForSocket && messageIdForSocket) {
    turn = beginTurn({
      messageId: messageIdForSocket,
      chatId: chatIdForSocket,
      userMessageId: userMessageIdForSocket,
      signal,
      broadcast,
      notify,
      onPartial,
      forwardContentChunks,
      forwardStatus,
    });
  }

  let response;
  try {
    response = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    turn?.discard();
    throw err;
  }

  if (!response.ok) {
    turn?.discard();
    const t = await response.text();
    throw new Error(`API Error (${response.status}): ${t || 'Unknown error'}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
    const json = await response.json().catch(() => null);
    if (json && typeof json === 'object') {
      if (json.error?.message) {
        turn?.discard();
        throw new Error(json.error.message);
      }
      if (json.detail) {
        turn?.discard();
        throw new Error(String(json.detail));
      }
      const taskIds = Array.isArray(json.task_ids)
        ? json.task_ids.map((id) => String(id || '')).filter(Boolean)
        : json.task_id
          ? [String(json.task_id)]
          : [];
      if (taskIds.length > 0) {
        if (!turn) {
          throw new Error(
            'Il server ha risposto in modalità task/socket ma la connessione realtime non è attiva.',
          );
        }
        // A brand new chat gets its id assigned server-side.
        const serverChatId = json.chat_id ? String(json.chat_id) : chatIdForSocket;
        if (json.chat_id) turn.adoptChatId(serverChatId);
        turn.attachTaskIds(taskIds);
        if (typeof onTaskIds === 'function') {
          onTaskIds({ taskIds, chatId: serverChatId });
        }
        return turn.promise;
      }
    }

    turn?.discard();
    throw new Error('Unexpected JSON response from chat completions (expected SSE stream)');
  }

  // Synchronous path: the body is the whole turn, so the socket consumer (if any)
  // is redundant.
  turn?.discard();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = {
    fullContent: '',
    fullReasoning: '',
    finishReason: null,
    toolAcc: new Map(),
    hadToolExecution: false,
    hadSources: false,
    hadFiles: false,
    fileItems: [],
    usage: null,
    streamError: null,
    outputItems: [],
    sawOutputItems: false,
    sawMessageContent: false,
  };

  const sink = {
    broadcast: (ev) => {
      if (typeof onStatus === 'function' && ev.type === 'status') onStatus(ev);
      if (typeof broadcast === 'function') broadcast(ev);
      else if (port) port.postMessage(ev);
    },
    port,
    forwardContentChunks,
    onPartial,
  };

  const parser = createSseFrameParser((parsed) => {
    if (!forwardStatus && parsed.type === 'status') return;
    processSseFrame(parsed, sink, state);
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
      if (parser.isDone()) break;
    }
    parser.flush();
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw err;
  }

  const toolCalls = finalizeToolCalls(state.toolAcc);
  if (state.hadToolExecution && !(state.fullContent || '').trim() && !state.hadFiles) {
    console.warn('[Neura stream] tool execution with empty content (SSE)', {
      toolCalls: toolCalls.map((tc) => tc?.function?.name),
      outputItemTypes: (state.outputItems || []).map((o) => o?.type),
      finishReason: state.finishReason,
      streamError: state.streamError,
      sawOutputItems: !!state.sawOutputItems,
      sawMessageContent: !!state.sawMessageContent,
    });
  }

  return {
    fullContent: state.fullContent || extractOutputText(state.outputItems),
    fullReasoning: state.fullReasoning || '',
    finishReason: state.finishReason,
    toolCalls,
    hadToolExecution: state.hadToolExecution,
    hadSources: state.hadSources,
    hadFiles: !!state.hadFiles,
    fileItems: state.fileItems || [],
    usage: state.usage,
    streamError: state.streamError,
    outputItems: state.outputItems || [],
  };
}
