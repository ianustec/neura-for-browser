import { getEndpoints } from './constants.js';
import { apiFetch } from './api-client.js';
import { extractFileId, fetchFileContentAsDataUrl } from './files-api.js';

export const OWUI_IMAGE_TOOL_NAMES = new Set(['generate_image', 'edit_image']);

/**
 * @param {unknown} argStr
 * @returns {Record<string, unknown>}
 */
export function parseToolArgs(argStr) {
  if (!argStr || typeof argStr !== 'string' || !argStr.trim()) return {};
  try {
    const parsed = JSON.parse(argStr);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Normalize OWUI `/api/v1/images/generations` (or edit) response into UI file items.
 * @param {unknown} result
 * @returns {{ type: string, url: string, name?: string }[]}
 */
export function normalizeImageApiResult(result) {
  /** @type {{ type: string, url: string, name?: string }[]} */
  const items = [];
  const list = Array.isArray(result)
    ? result
    : Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result?.images)
        ? result.images
        : result?.url
          ? [result]
          : [];

  for (const img of list) {
    if (!img) continue;
    if (typeof img === 'string') {
      items.push({ type: 'image', url: img });
      continue;
    }
    const url = img.url || img.b64_json || img.b64 || '';
    if (!url) continue;
    const finalUrl =
      typeof url === 'string' && !url.startsWith('data:') && !url.startsWith('http') && !url.startsWith('/')
        ? `data:image/png;base64,${url}`
        : url;
    items.push({
      type: 'image',
      url: finalUrl,
      name: img.name || img.filename || 'generated-image',
    });
  }
  return items;
}

/**
 * @param {string} prompt
 * @param {{ model?: string, size?: string, n?: number, negative_prompt?: string }} [opts]
 * @returns {Promise<{ type: string, url: string, name?: string }[]>}
 */
export async function generateImages(prompt, opts = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Missing image prompt');
  }
  const { IMAGES_GENERATIONS } = await getEndpoints();
  const body = {
    prompt,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.size ? { size: opts.size } : {}),
    ...(typeof opts.n === 'number' ? { n: opts.n } : {}),
    ...(opts.negative_prompt ? { negative_prompt: opts.negative_prompt } : {}),
  };
  const response = await apiFetch(IMAGES_GENERATIONS, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Image generation failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const json = await response.json();
  return normalizeImageApiResult(json);
}

/**
 * When the model calls edit_image with a page URL or other wrong source, fall back
 * to the OWUI file id(s) from attachments in this turn.
 * @param {unknown} modelUrls
 * @param {object[]} turnImages
 * @returns {string[]}
 */
export function resolveEditImageUrls(modelUrls, turnImages = []) {
  const knownRefs = (Array.isArray(turnImages) ? turnImages : [])
    .map((img) => String(img?.url || img?.id || '').trim())
    .filter(Boolean);
  const urls = Array.isArray(modelUrls) ? modelUrls : modelUrls ? [modelUrls] : [];
  const normalized = urls.map((u) => String(u || '').trim()).filter(Boolean);
  if (knownRefs.length === 0) return normalized;
  const allKnown =
    normalized.length > 0 && normalized.every((u) => knownRefs.includes(u));
  if (allKnown) return normalized;
  if (knownRefs.length === 1) return [knownRefs[0]];
  const matched = normalized.filter((u) => knownRefs.includes(u));
  return matched.length > 0 ? matched : knownRefs;
}

/**
 * OWUI image edit backends accept data URLs reliably; bare file ids often 400.
 * Resolve OWUI file ids (and /files/{id}/content paths) to authenticated data URLs.
 * @param {string[]} refs
 * @returns {Promise<string[]>}
 */
async function resolveImageRefsForEdit(refs) {
  const list = Array.isArray(refs) ? refs : refs ? [refs] : [];
  /** @type {string[]} */
  const out = [];
  for (const ref of list) {
    const s = String(ref || '').trim();
    if (!s) continue;
    if (s.startsWith('data:')) {
      out.push(s);
      continue;
    }
    const fileId = extractFileId(s);
    const isOwUiFileRef =
      !!fileId ||
      s.startsWith('/api/v1/files/') ||
      (!s.startsWith('http://') && !s.startsWith('https://') && /^[a-f0-9-]{8,}$/i.test(s));
    if (isOwUiFileRef) {
      const idToSend = fileId || s;
      try {
        const { dataUrl } = await fetchFileContentAsDataUrl(idToSend);
        out.push(dataUrl);
      } catch (e) {
        throw new Error(
          `Failed to resolve image for edit: ${String(e?.message || e)}`,
        );
      }
      continue;
    }
    out.push(s);
  }
  return out;
}

/**
 * @param {string} prompt
 * @param {string|string[]} imageUrls
 * @returns {Promise<{ type: string, url: string, name?: string }[]>}
 */
export async function editImages(prompt, imageUrls) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Missing edit prompt');
  }
  const raw = Array.isArray(imageUrls) ? imageUrls : imageUrls ? [imageUrls] : [];
  if (raw.length === 0) {
    throw new Error('Missing source image URL(s) for edit_image');
  }
  const images = await resolveImageRefsForEdit(raw);
  if (images.length === 0) {
    throw new Error('Missing source image URL(s) for edit_image');
  }
  const imageField = images.length === 1 ? images[0] : images;
  const { IMAGES_EDIT } = await getEndpoints();
  const bodyStr = JSON.stringify({
    form_data: {
      image: imageField,
      prompt,
    },
  });
  const response = await apiFetch(IMAGES_EDIT, {
    method: 'POST',
    body: bodyStr,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Image edit failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const json = await response.json();
  return normalizeImageApiResult(json);
}

/**
 * Execute OWUI builtin image tools (`generate_image` / `edit_image`) returned as tool_calls.
 * @param {object[]} toolCalls
 * @param {{ fallbackImageRefs?: object[] }} [opts]
 * @returns {Promise<{ fileItems: object[], toolResults: { callId: string, name: string, content: string }[] }>}
 */
export async function executeOwUiImageToolCalls(toolCalls, opts = {}) {
  const { fallbackImageRefs = [] } = opts;
  /** @type {object[]} */
  const fileItems = [];
  /** @type {{ callId: string, name: string, content: string }[]} */
  const toolResults = [];

  for (let i = 0; i < (toolCalls || []).length; i++) {
    const tc = toolCalls[i];
    const name = tc?.function?.name || '';
    if (!OWUI_IMAGE_TOOL_NAMES.has(name)) continue;

    const callId = tc.id || `img_call_${i}`;
    const args = parseToolArgs(tc.function?.arguments);
    const prompt = typeof args.prompt === 'string' ? args.prompt : '';

    try {
      let items = [];
      if (name === 'generate_image') {
        items = await generateImages(prompt, {
          model: typeof args.model === 'string' ? args.model : undefined,
          size: typeof args.size === 'string' ? args.size : undefined,
          n: typeof args.n === 'number' ? args.n : undefined,
          negative_prompt:
            typeof args.negative_prompt === 'string' ? args.negative_prompt : undefined,
        });
      } else if (name === 'edit_image') {
        const rawUrls = args.image_urls || args.images || args.image || [];
        const urls = resolveEditImageUrls(rawUrls, fallbackImageRefs);
        items = await editImages(prompt, urls);
      }
      fileItems.push(...items);
      toolResults.push({
        callId,
        name,
        content: JSON.stringify({
          status: 'success',
          message:
            'The image has been successfully generated and is already visible to the user in the chat. You do not need to display or embed the image again - just acknowledge that it has been created.',
          images: items.map((it) => ({ url: it.url })),
        }),
      });
    } catch (e) {
      toolResults.push({
        callId,
        name,
        content: JSON.stringify({ error: String(e?.message || e) }),
      });
    }
  }

  return { fileItems, toolResults };
}
