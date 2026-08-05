/**
 * Split composer attachments into Conduit/OpenWebUI completion shapes:
 * - images → multimodal user message content parts (image_url)
 * - everything else → top-level `files` array
 */

/**
 * @param {unknown} att
 * @returns {boolean}
 */
export function isImageAttachment(att) {
  if (!att || typeof att !== 'object') return false;
  const type = String(att.type || '').toLowerCase();
  if (type === 'image') return true;
  const ct = String(att.content_type || att.contentType || '').toLowerCase();
  return ct.startsWith('image/');
}

/**
 * @param {object} att
 * @returns {string}
 */
function dedupeKey(att) {
  return String(att.id || att.url || att.name || JSON.stringify(att));
}

/**
 * @param {object[]} attachments
 * @param {string} userText
 * @returns {{
 *   messageContent: string | object[],
 *   topLevelFiles: object[],
 *   hasImages: boolean
 * }}
 */
export function splitAttachmentsForCompletion(attachments, userText) {
  const list = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  const images = [];
  const topLevel = [];
  const seen = new Set();

  for (const att of list) {
    if (isImageAttachment(att)) {
      images.push(att);
      continue;
    }
    const key = dedupeKey(att);
    if (seen.has(key)) continue;
    seen.add(key);
    topLevel.push(att);
  }

  if (images.length === 0) {
    return {
      messageContent: typeof userText === 'string' ? userText : String(userText || ''),
      topLevelFiles: topLevel,
      images,
      hasImages: false,
    };
  }

  /** @type {object[]} */
  const parts = [{ type: 'text', text: typeof userText === 'string' ? userText : String(userText || '') }];
  for (const img of images) {
    const url = img.url || img.id;
    if (!url) continue;
    parts.push({
      type: 'image_url',
      image_url: { url },
    });
  }

  return {
    messageContent: parts,
    topLevelFiles: topLevel,
    images,
    hasImages: true,
  };
}

/**
 * The model receives attached images only as opaque `image_url` vision parts —
 * it can "see" them but never reads the `url`/id string as text, so it has no
 * way to know what to pass as `image_urls` when calling the native `edit_image`
 * tool. This builds a system message that spells out, as plain text, the exact
 * reference string (OWUI file id) for each image attached in this turn.
 * @param {object[]} images completion descriptors (type: 'image') for this turn
 * @returns {string|null}
 */
export function buildImageReferenceContextMessage(images) {
  const list = (Array.isArray(images) ? images : []).filter((img) => img && (img.url || img.id));
  if (list.length === 0) return null;

  const lines = list.map((img, i) => {
    const ref = img.url || img.id;
    const name = img.name || `image-${i + 1}`;
    return `[${i + 1}] name="${name}" image_urls_value="${ref}"`;
  });

  return (
    'The user has ALREADY attached the following image(s) in this turn — they are present in the chat ' +
    'and visible to you via vision. Do NOT ask the user for a URL, a Wikipedia link, or to upload the ' +
    'file again. Do NOT claim you cannot access the attachment.\n\n' +
    'The reference string below is what you MUST use verbatim as the `image_urls` argument when ' +
    'calling the edit_image tool — do not invent, guess, or alter this value:\n\n' +
    lines.join('\n') +
    '\n\nIf the user asks to modify/edit one of these images (e.g. "make it black and white", "remove the ' +
    'background", "add a hat"), you MUST call edit_image with image_urls set to the exact image_urls_value ' +
    'above for the image they mean (if there is only one image, use it; if there are several, infer which ' +
    'one from their instructions, e.g. "the second one"). Do NOT call generate_image in this case — ' +
    'generate_image creates a brand-new image from scratch and ignores the attached image, which is not ' +
    'what the user wants when they are referring to something they just attached.'
  );
}

/**
 * Apply split result onto a messages array (mutates last user message content).
 * @param {object[]} messages
 * @param {string | object[]} messageContent
 */
export function applyUserMessageContent(messages, messageContent) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      messages[i] = { ...messages[i], content: messageContent };
      return;
    }
  }
}
