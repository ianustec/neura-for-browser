(function (Neura) {
  /**
   * Unified composer attachments (uploaded files, web/YouTube context, # knowledge).
   * Mirrored after Conduit's attachedFiles + contextAttachments chip UX.
   */

  /** @type {object[]} */
  let pending = [];

  function getBar() {
    return Neura.shadow ? Neura.shadow.$('knowledge-attachments-bar') : null;
  }

  function attachmentKey(item) {
    return `${item.kind || item.type || 'x'}:${item.id || item.url || item.name || ''}`;
  }

  function toCompletionDescriptor(item) {
    if (item.descriptor && typeof item.descriptor === 'object') {
      return item.descriptor;
    }
    if (item.kind === 'collection') {
      return {
        type: 'collection',
        id: item.id,
        name: item.name,
        // Whole KB: Open WebUI expects the collection id here.
        collection_name: item.id,
      };
    }
    if (item.kind === 'file' || item.type === 'file' || item.type === 'image') {
      const desc = {
        type: item.type === 'image' ? 'image' : 'file',
        id: item.id,
        name: item.name,
        url: item.url || item.id,
      };
      if (item.knowledge || item.collectionName) {
        desc.knowledge = true;
        // Conduit: collection_name is the KB display name when known.
        desc.collection_name = item.collectionName || item.collection_name;
      }
      if (item.content_type) desc.content_type = item.content_type;
      return desc;
    }
    return item;
  }

  function renderChips() {
    const bar = getBar();
    if (!bar) return;
    bar.innerHTML = '';
    bar.style.display = pending.length > 0 ? 'flex' : 'none';

    pending.forEach((item, idx) => {
      const chip = document.createElement('span');
      chip.className = 'knowledge-attachment-chip';
      if (item.status === 'uploading' || item.status === 'pending') {
        chip.classList.add('is-uploading');
      }
      if (item.status === 'error') chip.classList.add('is-error');

      const icon = document.createElement('span');
      icon.className = 'knowledge-attachment-chip-icon';
      if (item.previewUrl) {
        icon.classList.add('has-thumb');
        const thumb = document.createElement('img');
        thumb.className = 'knowledge-attachment-chip-thumb';
        thumb.src = item.previewUrl;
        thumb.alt = '';
        icon.appendChild(thumb);
      } else if (item.kind === 'collection') {
        icon.textContent = '\u{1F5C4}\uFE0F';
      } else if (item.kind === 'web' || item.kind === 'youtube') {
        icon.classList.add('knowledge-attachment-chip-icon--page');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="11" cy="12" r="8.5" fill="currentColor" fill-opacity="0.18" stroke="currentColor"/>' +
          '<path d="M2.5 12h17"/>' +
          '<path d="M11 3.5c3.2 2.4 3.2 12.6 0 17"/>' +
          '<path d="M11 3.5c-3.2 2.4-3.2 12.6 0 17"/>' +
          '<path d="M18.2 5.2l.55 1.25 1.25.55-1.25.55-.55 1.25-.55-1.25-1.25-.55 1.25-.55z" fill="currentColor" stroke="none"/>' +
          '</svg>';
      } else if (item.type === 'image' || String(item.content_type || '').startsWith('image/')) {
        icon.textContent = '\u{1F5BC}\uFE0F';
      } else {
        icon.textContent = '\u{1F4C4}';
      }
      const label = document.createElement('span');
      label.className = 'knowledge-attachment-chip-label';
      let labelText = item.name || item.url || Neura.i18n.t('attachFile');
      if (item.status === 'uploading') labelText = `${labelText}\u2026`;
      if (item.status === 'error') labelText = `${labelText} (!)`;
      label.textContent = labelText;
      if (item.error) label.title = item.error;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'knowledge-attachment-chip-remove';
      removeBtn.title = Neura.i18n.t('knowledgeMentionRemove');
      removeBtn.textContent = '\u00D7';
      removeBtn.addEventListener('click', () => {
        if (item.previewUrl) {
          try {
            URL.revokeObjectURL(item.previewUrl);
          } catch (e) {
            /* ignore */
          }
        }
        pending.splice(idx, 1);
        renderChips();
      });

      chip.appendChild(icon);
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      bar.appendChild(chip);
    });
  }

  function addItem(item) {
    if (!item) return;
    const key = attachmentKey(item);
    const existing = pending.findIndex((p) => attachmentKey(p) === key);
    if (existing >= 0) pending[existing] = { ...pending[existing], ...item };
    else pending.push(item);
    renderChips();
  }

  function updateItem(keyMatch, patch) {
    const idx = pending.findIndex((p) => attachmentKey(p) === keyMatch || p.localId === keyMatch);
    if (idx < 0) return;
    pending[idx] = { ...pending[idx], ...patch };
    renderChips();
  }

  function getPendingAttachments() {
    return pending
      .filter((p) => p.status !== 'uploading' && p.status !== 'pending' && p.status !== 'error')
      .map(toCompletionDescriptor);
  }

  /**
   * Slim descriptors for user-bubble UI / local chat persistence (no huge content).
   * Mirrors Conduit folding context attachments onto the user message before clear.
   * @param {object[]} attachments completion descriptors
   * @returns {object[]}
   */
  function toDisplayFiles(attachments) {
    return (Array.isArray(attachments) ? attachments : [])
      .filter(Boolean)
      .map((att) => {
        const sourceUrl =
          att.sourceUrl ||
          (String(att.url || '').startsWith('http') ? att.url : '') ||
          '';
        const isPageContext =
          att.context === 'page' ||
          att.context === 'full' ||
          att.type === 'text' ||
          !!sourceUrl;
        // Keep OWUI type:file for the API, but surface a warmer UI kind for chips.
        const type = isPageContext
          ? att.context === 'full'
            ? 'youtube'
            : 'page'
          : att.type || 'file';
        const name =
          att.name ||
          att.file?.meta?.name ||
          sourceUrl ||
          att.url ||
          att.id ||
          Neura.i18n.t('attachFile');
        /** @type {Record<string, unknown>} */
        const out = { type, name };
        if (att.id) out.id = att.id;
        if (att.url) out.url = att.url;
        if (sourceUrl) out.sourceUrl = sourceUrl;
        if (att.content_type) out.content_type = att.content_type;
        if (att.knowledge) out.knowledge = true;
        if (att.collection_name) out.collection_name = att.collection_name;
        if (att.context) out.context = att.context;
        return out;
      });
  }

  /**
   * Re-queue completion descriptors into the composer after a failed send.
   * @param {object[]} attachments
   */
  function restoreAttachments(attachments) {
    const list = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
    for (const att of list) {
      const sourceUrl = att.sourceUrl || (String(att.url || '').startsWith('http') ? att.url : '');
      const isWeb =
        att.type === 'text' ||
        !!sourceUrl ||
        att.context === 'full';
      addItem({
        localId: `restore_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: isWeb
          ? att.context === 'full'
            ? 'youtube'
            : 'web'
          : att.type === 'collection'
            ? 'collection'
            : 'upload',
        id: att.id || att.url || `restored_${Date.now()}`,
        name: att.name || att.file?.meta?.name || att.url || '',
        url: sourceUrl || att.url,
        type: att.type,
        content_type: att.content_type,
        knowledge: att.knowledge,
        collectionName: att.collection_name,
        status: 'completed',
        descriptor: att,
      });
    }
    renderChips();
  }

  /**
   * Truncate oversized web/YouTube text content so port.postMessage stays reliable.
   * @param {object[]} attachments
   * @param {number} [maxTotalChars]
   * @returns {object[]}
   */
  function truncateForTransport(attachments, maxTotalChars = 80000) {
    const list = (Array.isArray(attachments) ? attachments : []).map((a) =>
      a && typeof a === 'object' ? { ...a } : a,
    );
    let budget = maxTotalChars;
    for (const att of list) {
      if (!att || att.type !== 'text') continue;
      const content = att.file?.data?.content;
      if (typeof content !== 'string') continue;
      if (content.length <= budget) {
        budget -= content.length;
        continue;
      }
      const kept = Math.max(2000, budget);
      const truncated =
        content.slice(0, kept) + (Neura.i18n.t('payloadTruncated') || '\n\n[...truncated...]');
      att.file = {
        ...(att.file || {}),
        data: { ...(att.file?.data || {}), content: truncated },
        meta: { ...(att.file?.meta || {}) },
      };
      budget = 0;
    }
    return list;
  }

  function hasUploading() {
    return pending.some((p) => p.status === 'uploading' || p.status === 'pending');
  }

  function clearPendingAttachments() {
    for (const item of pending) {
      if (item && item.previewUrl) {
        try {
          URL.revokeObjectURL(item.previewUrl);
        } catch (e) {
          /* ignore */
        }
      }
    }
    pending = [];
    renderChips();
  }

  /**
   * @param {File} file
   */
  async function uploadLocalFile(file) {
    if (!file) return;
    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const contentType = file.type || '';
    const isImage = contentType.startsWith('image/');
    const previewUrl = isImage ? URL.createObjectURL(file) : null;
    addItem({
      localId,
      kind: 'upload',
      id: localId,
      name: file.name,
      content_type: contentType,
      type: isImage ? 'image' : 'file',
      status: 'uploading',
      previewUrl,
    });

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const base64 = btoa(binary);

      const response = await chrome.runtime.sendMessage({
        action: 'owui:uploadFile',
        fileName: file.name,
        contentType,
        base64,
      });
      if (!response?.ok || !response.attachment) {
        throw new Error(response?.error || 'Upload failed');
      }
      const att = response.attachment;
      updateItem(localId, {
        localId,
        kind: 'upload',
        id: att.id,
        name: att.name || file.name,
        url: att.url || att.id,
        type: att.type,
        content_type: att.content_type || contentType,
        status: 'completed',
        descriptor: att,
        error: undefined,
      });
    } catch (e) {
      updateItem(localId, {
        status: 'error',
        error: String(e?.message || e),
      });
      throw e;
    }
  }

  /**
   * True when url is the tab we are running in (same document the user sees).
   * @param {string} url
   * @returns {boolean}
   */
  function isCurrentTabUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return false;
    try {
      const a = new URL(trimmed);
      const b = new URL(window.location.href);
      return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
    } catch {
      return trimmed === window.location.href;
    }
  }

  /**
   * Attach the page open in this tab: scrape DOM → upload as OWUI file.
   * YouTube stays on server ingest so we still get the transcript.
   * @param {string} [displayName]
   */
  async function attachCurrentPage(displayName) {
    const url = window.location.href;
    if (isYouTubeUrl(url)) {
      return attachPageUrl(url, displayName || document.title || url);
    }
    const localId = `web_${Date.now()}`;
    const name = displayName || document.title || url;
    addItem({
      localId,
      kind: 'web',
      id: localId,
      name,
      url,
      status: 'uploading',
    });
    try {
      if (!Neura.pageContext?.getPageContextAsync && !Neura.pageContext?.getPageContext) {
        throw new Error(Neura.i18n.t('attachPageFailed'));
      }
      const ctx = Neura.pageContext.getPageContextAsync
        ? await Neura.pageContext.getPageContextAsync()
        : await Neura.pageContext.getPageContext();
      const response = await chrome.runtime.sendMessage({
        action: 'owui:uploadPageContext',
        title: name || ctx.title,
        url: ctx.url || url,
        description: ctx.description,
        text: ctx.text,
      });
      if (!response?.ok || !response.attachment) {
        throw new Error(response?.error || Neura.i18n.t('attachPageFailed'));
      }
      const att = response.attachment;
      updateItem(localId, {
        localId,
        kind: 'web',
        id: att.id,
        name: att.name || name,
        url: att.sourceUrl || ctx.url || url,
        type: att.type || 'file',
        content_type: att.content_type || 'text/plain',
        status: 'completed',
        descriptor: att,
        error: undefined,
      });
    } catch (e) {
      updateItem(localId, {
        status: 'error',
        error: String(e?.message || e),
      });
      throw e;
    }
  }

  /**
   * Ingest a URL via OWUI (server-side fetch). Prefer attachCurrentPage when the
   * URL is the active tab so authenticated pages keep the user's session.
   * @param {string} url
   * @param {string} [displayName]
   */
  async function attachPageUrl(url, displayName) {
    const trimmed = String(url || '').trim();
    if (isCurrentTabUrl(trimmed) && !isYouTubeUrl(trimmed)) {
      return attachCurrentPage(displayName || document.title || trimmed);
    }

    const localId = `web_${Date.now()}`;
    addItem({
      localId,
      kind: 'web',
      id: localId,
      name: displayName || trimmed,
      url: trimmed,
      status: 'uploading',
    });
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'owui:ingestUrl',
        url: trimmed,
        displayName: displayName || '',
      });
      if (!response?.ok || !response.attachment) {
        throw new Error(response?.error || Neura.i18n.t('attachPageFailed'));
      }
      const att = response.attachment;
      updateItem(localId, {
        localId,
        kind: att.context === 'full' || isYouTubeUrl(trimmed) ? 'youtube' : 'web',
        id: att.id || att.url || localId,
        name: att.name || att.file?.meta?.name || displayName || trimmed,
        url: att.sourceUrl || att.url || trimmed,
        type: att.type || 'file',
        content_type: att.content_type,
        status: 'completed',
        descriptor: att,
        error: undefined,
      });
    } catch (e) {
      updateItem(localId, {
        status: 'error',
        error: String(e?.message || e),
      });
      throw e;
    }
  }

  /** Lightweight YouTube host check (mirrors background retrieval-api). */
  function isYouTubeUrl(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      return (
        host === 'youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'youtu.be' ||
        host.endsWith('.youtube.com')
      );
    } catch {
      return /youtube\.com|youtu\.be/i.test(String(url || ''));
    }
  }

  /**
   * Attach an image pasted/typed as a URL (from the internet, not a page to scrape).
   * Downloads it in the background (no CORS) and re-uploads via the normal OWUI
   * files pipeline so it becomes a completion-ready `type: 'image'` attachment,
   * identical to a local file upload (same thumbnail, same edit_image reference flow).
   * @param {string} url
   */
  async function attachImageUrl(url) {
    const localId = `imgurl_${Date.now()}`;
    addItem({
      localId,
      kind: 'upload',
      id: localId,
      name: url,
      type: 'image',
      status: 'uploading',
      previewUrl: url,
    });
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'owui:uploadImageFromUrl',
        url,
      });
      if (!response?.ok || !response.attachment) {
        throw new Error(response?.error || Neura.i18n.t('attachPageFailed'));
      }
      const att = response.attachment;
      updateItem(localId, {
        localId,
        kind: 'upload',
        id: att.id,
        name: att.name || url,
        url: att.url || att.id,
        type: att.type,
        content_type: att.content_type,
        status: 'completed',
        descriptor: att,
        error: undefined,
        previewUrl: url,
      });
    } catch (e) {
      updateItem(localId, {
        status: 'error',
        error: String(e?.message || e),
      });
      throw e;
    }
  }

  /** Recognize a bare URL pointing directly at an image file (by extension). */
  function isDirectImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  /**
   * Paste handler entry: attach clipboard image URL without inserting raw text.
   * @param {string} text clipboard plain text
   * @param {HTMLTextAreaElement} [messageInput]
   * @returns {Promise<boolean>} true if attach was started
   */
  async function tryAttachPastedImageUrl(text, messageInput) {
    const trimmed = String(text || '').trim();
    if (!isDirectImageUrl(trimmed)) return false;
    if (messageInput) {
      messageInput.value = '';
      if (Neura.input?.autoResizeTextarea) Neura.input.autoResizeTextarea(messageInput);
    }
    await attachImageUrl(trimmed);
    return true;
  }

  /** Used by # knowledge mention to share the same chip bar. */
  function addKnowledgeItem(item) {
    addItem({
      ...item,
      status: 'completed',
      descriptor: undefined,
    });
  }

  Neura.fileAttachments = {
    renderChips,
    addItem,
    addKnowledgeItem,
    uploadLocalFile,
    attachCurrentPage,
    attachPageUrl,
    attachImageUrl,
    tryAttachPastedImageUrl,
    isDirectImageUrl,
    getPendingAttachments,
    toDisplayFiles,
    truncateForTransport,
    restoreAttachments,
    clearPendingAttachments,
    hasUploading,
  };
})(window.Neura);
