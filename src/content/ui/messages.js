(function (Neura) {
  function copyIconSVG() {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>`;
  }

  function editIconSVG() {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    `;
  }

  function deleteIconSVG() {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3,6 5,6 21,6"></polyline>
        <path d="M19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>
    `;
  }

  function insertBeforeMessageContent(wrapperEl, el) {
    if (!wrapperEl || !el) return;
    const contentDiv = wrapperEl.querySelector('.message-content');
    if (contentDiv) wrapperEl.insertBefore(el, contentDiv);
    else wrapperEl.appendChild(el);
  }

  function reorderExploredBeforeLastThought(wrapperEl, exploredBlock) {
    if (!wrapperEl || !exploredBlock) return;
    const thoughts = wrapperEl.querySelectorAll('.neura-thought-block.has-content');
    const lastThought = thoughts[thoughts.length - 1];
    if (!lastThought || lastThought.compareDocumentPosition(exploredBlock) & Node.DOCUMENT_POSITION_PRECEDING) {
      return;
    }
    wrapperEl.insertBefore(exploredBlock, lastThought);
  }

  function thoughtDoneLabel(block) {
    const started = block._startedAt || Date.now();
    const secs = Math.round((Date.now() - started) / 1000);
    if (secs < 1) return Neura.i18n.t('thoughtDoneSubSecond');
    if (secs === 1) return Neura.i18n.t('thoughtDoneOne');
    return Neura.i18n.t('thoughtDoneMany', secs);
  }

  function isThoughtPlaceholderText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return true;
    return trimmed === Neura.i18n.t('thoughtWaiting');
  }

  function getThoughtReasoningText(block) {
    if (!block) return '';
    const stored = (block._reasoningText || '').trim();
    if (stored) return stored;
    const body = block.querySelector('.neura-thought-body');
    if (!body || body.dataset.placeholder === 'true') return '';
    const bodyText = (body.textContent || '').trim();
    if (isThoughtPlaceholderText(bodyText)) return '';
    return bodyText;
  }

  function thoughtBlockHasContent(block) {
    return !!getThoughtReasoningText(block);
  }

  function syncThoughtBlockContentState(block) {
    if (!block) return;
    const hasContent = thoughtBlockHasContent(block);
    block.classList.toggle('has-content', hasContent);
    block.classList.toggle('is-waiting', !hasContent && block.classList.contains('is-active'));
    if (!hasContent) block.open = false;
  }

  /**
   * Reasoning arrives one chunk at a time and each chunk refreshes the panel,
   * so the automatic open/close rules would keep overriding the reader while
   * the answer is still streaming. Remember that they acted on the panel and
   * leave it alone from then on.
   */
  function bindUserToggleIntent(block) {
    const summary = block?.querySelector('summary');
    if (!summary || summary._neuraIntentBound) return;
    summary._neuraIntentBound = true;
    summary.addEventListener('click', () => {
      block.dataset.userToggled = 'true';
    });
  }

  function userDecidedPanelState(block) {
    return block?.dataset?.userToggled === 'true';
  }

  function bindThoughtBlockGuard(block) {
    if (!block) return;
    bindUserToggleIntent(block);
    if (block._thoughtGuardBound) return;
    block._thoughtGuardBound = true;
    block.addEventListener('toggle', () => {
      if (block.open && !thoughtBlockHasContent(block)) {
        block.open = false;
      }
    });
  }

  function expandReasoningSegments(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    if (raw.includes('<details') && Neura.contentPartition?.partitionOwUiContent) {
      const partitioned = Neura.contentPartition.partitionOwUiContent(raw).thought || '';
      if (partitioned.trim()) {
        return partitioned.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
      }
    }
    const parts = raw.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1 || parts.some((part) => /^🔧\s/.test(part))) return parts;
    const inline = raw.split(/(?=🔧\s)/).map((part) => part.trim()).filter(Boolean);
    return inline.length > 1 ? inline : parts;
  }

  function countThoughtSegments(text) {
    return expandReasoningSegments(text).length;
  }

  function buildStructuredThoughtText(timeline) {
    if (!Array.isArray(timeline) || timeline.length === 0) return '';
    return timeline
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        if (entry.kind === 'tool') return `🔧 ${String(entry.name || '').trim()}`;
        return String(entry.text || '').trim();
      })
      .filter(Boolean)
      .join('\n\n');
  }

  function createThoughtBlockEl(opts = {}) {
    const block = document.createElement('details');
    block.className = 'neura-thought-block is-active';
    block.open = false;
    block._startedAt = Date.now();
    block._reasoningText = '';

    const summary = document.createElement('summary');
    summary.className = 'neura-thought-summary';

    const label = document.createElement('span');
    label.className = 'neura-thought-label';
    label.textContent = Neura.i18n.t('thoughtActive');
    summary.appendChild(label);

    const chevron = document.createElement('span');
    chevron.className = 'neura-step-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    summary.appendChild(chevron);

    block.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'neura-thought-body';
    block.appendChild(body);

    bindThoughtBlockGuard(block);
    syncThoughtBlockContentState(block);
    return block;
  }

  function finalizeThoughtBlockElement(block, opts = {}) {
    if (!block) return;

    const body = block.querySelector('.neura-thought-body');
    if (body?.dataset?.placeholder === 'true') {
      delete body.dataset.placeholder;
      body.textContent = '';
    }

    const finalText = getThoughtReasoningText(block);
    if (!finalText) {
      block.remove();
      return;
    }

    block._reasoningText = finalText;
    if (body) {
      body.textContent = Neura.markdown.normalizeThoughtText(finalText);
    }

    const label = block.querySelector('.neura-thought-label');
    if (label) label.textContent = thoughtDoneLabel(block);

    block.classList.remove('is-active');
    block.classList.remove('is-waiting');
    block.classList.add('has-content');
    syncThoughtBlockContentState(block);
    if (opts.collapse !== false && !userDecidedPanelState(block)) block.open = false;
  }


  function dedupeThoughtBlocks(wrapperEl) {
    if (!wrapperEl) return;
    const blocks = Array.from(wrapperEl.querySelectorAll('.neura-thought-block'));
    let prevKey = null;
    for (const block of blocks) {
      const text = getThoughtReasoningText(block).replace(/\s+/g, ' ').trim();
      const key = text || '__empty__';
      if (key === '__empty__') {
        block.remove();
        continue;
      }
      if (key === prevKey) {
        block.remove();
        continue;
      }
      prevKey = key;
    }
  }

  function attachUserActions(messageContainer, messageDiv, text) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'message-action-btn edit-btn';
    editBtn.title = Neura.i18n.t('editMessage');
    editBtn.innerHTML = editIconSVG();
    editBtn.onclick = (e) => {
      e.stopPropagation();
      Neura.messageActions.editUserMessage(messageDiv, text);
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'message-action-btn delete-btn';
    deleteBtn.title = Neura.i18n.t('deleteMessage');
    deleteBtn.innerHTML = deleteIconSVG();
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      Neura.messageActions.deleteUserMessage(messageContainer);
    };

    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(deleteBtn);
    messageContainer.appendChild(actionsDiv);
  }

  function attachAssistantCopy(messageContainer, text) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'message-action-btn copy-btn';
    copyBtn.title = Neura.i18n.t('copyMessageTooltip');
    copyBtn.innerHTML = copyIconSVG();
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      Neura.messageActions.copyAssistantMessage(text, copyBtn);
    };

    actionsDiv.appendChild(copyBtn);
    messageContainer.appendChild(actionsDiv);
  }

  function handleResize() {
    Neura.messages.updateMessageAreaHeight();
  }

  /**
   * Load OWUI file URLs with the session JWT (host-page <img> cannot send Authorization).
   * @param {string} url
   * @returns {Promise<string>}
   */
  function resolveAuthenticatedImageSrc(url) {
    if (!url || typeof url !== 'string') return Promise.resolve('');
    if (url.startsWith('data:') || url.startsWith('blob:')) return Promise.resolve(url);
    // Public absolute URLs that are not OWUI file endpoints can load directly.
    if (/^https?:\/\//i.test(url) && !/\/api\/v1\/files\//i.test(url)) {
      return Promise.resolve(url);
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { action: 'owui:fetchFileContent', url },
          (response) => {
            if (chrome.runtime.lastError) {
              console.warn('Neura: fetchFileContent failed', chrome.runtime.lastError.message);
              resolve(url);
              return;
            }
            if (response?.ok && response.dataUrl) resolve(response.dataUrl);
            else resolve(url);
          },
        );
      } catch (e) {
        resolve(url);
      }
    });
  }

  /**
   * Open an already-resolved image src (data: or authenticated blob-turned
   * data: URL) full-size in a new tab. Chrome truncates/blanks `data:`
   * navigations, so an `about:blank` tab with an injected `<img>` is used.
   * @param {string} src
   * @param {string} [alt]
   */
  function openImageInNewTab(src, alt) {
    if (!src) return;
    const w = window.open('about:blank', '_blank');
    if (!w) return;
    try {
      w.document.title = alt || 'Image';
      const style = w.document.createElement('style');
      style.textContent =
        'html,body{margin:0;background:#111;min-height:100%;display:flex;align-items:center;justify-content:center}' +
        'img{max-width:100%;height:auto;display:block}';
      w.document.head.appendChild(style);
      const img = w.document.createElement('img');
      img.alt = alt || '';
      img.src = src;
      w.document.body.appendChild(img);
    } catch (err) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
  }

  Neura.messages = {
    attachResizeObserver(chatWindow) {
      if (!chatWindow) return;
      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(chatWindow);
    },

    updateMessageAreaHeight() {
      const messageArea = Neura.shadow.$('message-area');
      if (messageArea) messageArea.style.height = '';
    },

    addMessageToChat(user, text, options = {}) {
      const messageArea = Neura.shadow.$('message-area');
      if (!messageArea) return null;

      const messageContainer = document.createElement('div');
      messageContainer.className = 'message-container';
      if (options.messageId) {
        messageContainer.dataset.messageId = options.messageId;
      }

      const messageDiv = document.createElement('div');
      messageDiv.className = `message ${user === 'user' ? 'user-message' : 'assistant-message'}`;
      if (options.messageId) {
        messageDiv.dataset.messageId = options.messageId;
      }

      if (user === 'assistant') {
        const iconImg = document.createElement('img');
        iconImg.className = 'assistant-avatar';
        iconImg.src = Neura.branding?.getAssistantIconSrc?.() || Neura.paths.iconWhite;
        iconImg.style.cssText = 'height: 20px; width: 20px; margin-right: 10px; border-radius: 4px; object-fit: contain; flex-shrink: 0;';
        // Prefer the model that actually produced this message (from history/
        // sync); only fall back to whatever model is active right now for
        // messages that never recorded one (e.g. legacy history).
        const model = options.model || Neura.modelIcons?.getActiveModel?.();
        if (model && Neura.modelIcons) {
          Neura.modelIcons.applyToImg(iconImg, model);
        }
        messageDiv.appendChild(iconImg);
      }

      const files = Array.isArray(options.files) ? options.files : [];

      if (user === 'assistant' && files.length > 0) {
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'message-content-wrapper';
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.style.width = '100%';
        let displayText = text;
        if (text && Neura.contentPartition?.partitionOwUiContent) {
          const parts = Neura.contentPartition.partitionOwUiContent(text);
          displayText = parts.content || '';
          if (parts.thought) {
            Neura.messages.renderPartitionedThoughtUi(contentWrapper, parts.thought);
          }
        }
        if (displayText) {
          contentDiv.innerHTML = Neura.markdown.parseMarkdown(displayText);
          Neura.markdown.highlightCodeBlocks(contentDiv);
        }
        contentWrapper.appendChild(contentDiv);
        Neura.messages.appendFilesBlock(contentWrapper, files);
        messageDiv.appendChild(contentWrapper);
      } else {
        const contentDiv = document.createElement('div');
        contentDiv.style.width = '100%';

        if (user === 'user') {
          if (files.length > 0) {
            Neura.messages.appendUserAttachmentsBlock(messageDiv, files);
          }
          // Attachment-only messages have no caption text (matches OWUI).
          if (text) {
            const escaped = Neura.markdown.escapeHtml(text);
            contentDiv.className = 'user-message-text';
            contentDiv.innerHTML = escaped.replace(/ /g, '&nbsp;').replace(/\n/g, '<br>');
            messageDiv.appendChild(contentDiv);
          }
        } else if (user === 'assistant' && text.startsWith('<img')) {
          contentDiv.innerHTML = text;
          const image = contentDiv.querySelector('img');
          if (image) {
            image.style.maxWidth = '100%';
            image.style.height = 'auto';
          }
          messageDiv.appendChild(contentDiv);
        } else {
          let displayText = text;
          let thoughtText = '';
          if (text && Neura.contentPartition?.partitionOwUiContent) {
            const parts = Neura.contentPartition.partitionOwUiContent(text);
            displayText = parts.content || '';
            thoughtText = parts.thought || '';
          }
          if (thoughtText) {
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'message-content-wrapper';
            Neura.messages.renderPartitionedThoughtUi(contentWrapper, thoughtText);
            contentDiv.innerHTML = Neura.markdown.parseMarkdown(displayText || '');
            Neura.markdown.highlightCodeBlocks(contentDiv);
            contentWrapper.appendChild(contentDiv);
            messageDiv.appendChild(contentWrapper);
          } else {
            contentDiv.innerHTML = Neura.markdown.parseMarkdown(displayText || '');
            Neura.markdown.highlightCodeBlocks(contentDiv);
            messageDiv.appendChild(contentDiv);
          }
        }
      }
      messageContainer.appendChild(messageDiv);

      if (user === 'user') {
        attachUserActions(messageContainer, messageDiv, text);
      } else {
        attachAssistantCopy(messageContainer, text);
      }

      messageArea.appendChild(messageContainer);
      if (Neura.state.autoScrollEnabled) {
        messageArea.scrollTop = messageArea.scrollHeight;
      }
      return messageContainer;
    },

    showImportBanner() {
      const messageArea = Neura.shadow.$('message-area');
      if (!messageArea || messageArea.querySelector('.neura-import-banner')) return;
      const banner = document.createElement('div');
      banner.className = 'neura-import-banner';
      banner.textContent = Neura.i18n.t('importedChatBanner');
      messageArea.insertBefore(banner, messageArea.firstChild);
    },

    toggleSendIcon(state) {
      const sendIcon = Neura.shadow.$('send-icon');
      const sendButton = Neura.shadow.$('send-button');
      const textarea = Neura.shadow.$('message-input');
      if (!sendIcon || !textarea) return;
      if (state === 'loading' || state === 'stop') {
        sendIcon.classList.add('loading');
        sendIcon.classList.remove('loading-icon');
        sendIcon.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>
          </svg>`;
        sendIcon.title = Neura.i18n.t('stopGeneration');
        if (sendButton) sendButton.style.transform = 'translateY(-50%) scale(1.05)';
        textarea.disabled = true;
      } else {
        sendIcon.classList.remove('loading', 'loading-icon');
        sendIcon.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>`;
        sendIcon.title = Neura.i18n.t('sendMessage');
        if (sendButton) sendButton.style.transform = '';
        textarea.disabled = false;
      }
    },

    resetInput() {
      const messageInput = Neura.shadow.$('message-input');
      if (!messageInput) return;
      messageInput.value = '';
      messageInput.style.height = '26px';
      Neura.messages.updateMessageAreaHeight();
      Neura.focus.focusMessageInput();
    },

    startChatMessage(user, initialText = '') {
      const messageArea = Neura.shadow.$('message-area');
      if (!messageArea) return null;
      const messageContainer = document.createElement('div');
      messageContainer.className = 'message-container';
      messageContainer.id = 'loading-message';

      const messageDiv = document.createElement('div');
      messageDiv.className = `message ${user === 'user' ? 'user-message' : 'assistant-message'}`;

      const iconImg = document.createElement('img');
      iconImg.className = user === 'user' ? 'user-avatar' : 'assistant-avatar';
      iconImg.src =
        user === 'user'
          ? 'https://cdn-icons-png.flaticon.com/512/4315/4315730.png'
          : Neura.branding?.getAssistantIconSrc?.() || Neura.paths.iconWhite;
      iconImg.style.cssText = 'height: 20px; width: 20px; margin-right: 10px; border-radius: 4px; object-fit: contain;';
      if (user === 'assistant') {
        const activeModel = Neura.modelIcons?.getActiveModel?.();
        if (activeModel && Neura.modelIcons) {
          Neura.modelIcons.applyToImg(iconImg, activeModel);
        }
      }
      messageDiv.appendChild(iconImg);

      const contentDiv = document.createElement('div');
      contentDiv.style.width = '100%';
      contentDiv.innerHTML =
        initialText || `<span class="loading-indicator">${Neura.i18n.t('loading')}</span>`;
      messageDiv.appendChild(contentDiv);

      messageContainer.appendChild(messageDiv);
      messageArea.appendChild(messageContainer);
      if (Neura.state.autoScrollEnabled) messageArea.scrollTop = messageArea.scrollHeight;
      return { messageContainer, messageDiv, contentDiv };
    },

    endChatMessage() {
      const shadowRoot = Neura.shadow.root();
      const loadingMessage = shadowRoot && shadowRoot.getElementById('loading-message');
      if (loadingMessage) loadingMessage.remove();
    },

    upsertStatusChip(wrapperEl, opts) {
      if (!wrapperEl || (opts && opts.hidden)) return;
      const raw = ((opts && opts.description) || '').trim();
      const description = Neura.i18n.localizeStatus(raw);
      let chip = wrapperEl.querySelector('.neura-status-chip');
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'neura-status-chip';
        chip.setAttribute('role', 'status');
        wrapperEl.insertBefore(chip, wrapperEl.firstChild);
      }
      chip.textContent = description || Neura.i18n.t('ellipsis');
      chip.classList.toggle('is-done', !!(opts && opts.done));
    },

    appendSourcesBlock(wrapperEl, sources) {
      if (!wrapperEl || !Array.isArray(sources) || sources.length === 0) return;
      let block = wrapperEl.querySelector('.neura-sources-block');
      const items = sources
        .map((s) => {
          if (!s) return null;
          if (typeof s === 'string') return { url: s, name: s };
          const src = s.source || s;
          const url = src.url || src.link || s.url || '';
          const name = src.name || src.title || s.name || s.title || url || Neura.i18n.t('sourceDefault');
          return { url, name };
        })
        .filter(Boolean);
      if (items.length === 0) return;
      if (!block) {
        block = document.createElement('details');
        block.className = 'neura-sources-block';
        const summary = document.createElement('summary');
        summary.textContent = Neura.i18n.t('sources', items.length);
        block.appendChild(summary);
        const list = document.createElement('ul');
        list.className = 'neura-sources-list';
        block.appendChild(list);
        wrapperEl.appendChild(block);
      }
      const list = block.querySelector('.neura-sources-list');
      const existing = new Set(
        Array.from(list.querySelectorAll('a')).map((a) => a.getAttribute('href') || ''),
      );
      for (const it of items) {
        if (existing.has(it.url)) continue;
        const li = document.createElement('li');
        const a = document.createElement('a');
        if (it.url) {
          a.href = it.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        a.textContent = it.name;
        li.appendChild(a);
        list.appendChild(li);
      }
      const summary = block.querySelector('summary');
      if (summary) summary.textContent = Neura.i18n.t('sources', list.children.length);
    },

    appendFilesBlock(wrapperEl, files) {
      if (!wrapperEl || !Array.isArray(files) || files.length === 0) return;
      let block = wrapperEl.querySelector('.neura-files-block');
      if (!block) {
        block = document.createElement('div');
        block.className = 'neura-files-block';
        // Conduit: files above markdown body
        const messageContent = wrapperEl.querySelector('.message-content');
        if (messageContent) {
          wrapperEl.insertBefore(block, messageContent);
        } else {
          wrapperEl.appendChild(block);
        }
      }
      const seen = new Set([
        ...Array.from(block.querySelectorAll('a')).map((a) => a.getAttribute('href') || ''),
        ...Array.from(block.querySelectorAll('img.neura-generated-image')).map(
          (img) => img.dataset.sourceUrl || img.getAttribute('src') || '',
        ),
      ]);

      for (const f of files) {
        if (!f) continue;
        const url = f.url || f.href || f.path || f.id || (f.file && (f.file.url || f.file.id)) || '';
        const name =
          f.name || f.filename || f.title || (f.file && f.file.name) || Neura.i18n.t('fileDefault');
        const contentType =
          f.content_type ||
          f.contentType ||
          (f.file && (f.file.content_type || f.file.contentType)) ||
          '';
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const isImage =
          f.type === 'image' ||
          (typeof contentType === 'string' && contentType.startsWith('image/')) ||
          /^data:image\//i.test(url) ||
          /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(url);

        if (isImage) {
          const figure = document.createElement('figure');
          figure.className = 'neura-generated-image-wrap';
          const img = document.createElement('img');
          img.className = 'neura-generated-image';
          img.alt = name;
          img.loading = 'lazy';
          img.dataset.sourceUrl = url;
          figure.appendChild(img);
          block.appendChild(figure);
          resolveAuthenticatedImageSrc(url).then((src) => {
            if (src) img.src = src;
            else img.src = url;
          });
          continue;
        }

        const chip = document.createElement('a');
        chip.className = 'neura-file-chip';
        chip.href = url;
        chip.target = '_blank';
        chip.rel = 'noopener noreferrer';
        chip.setAttribute('download', name);
        chip.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span>${Neura.markdown.escapeHtml(name)}</span>`;
        block.appendChild(chip);
      }
    },

    /**
     * Non-removable chips on the user bubble (Conduit: userMessage.files).
     * @param {HTMLElement} messageDiv
     * @param {object[]} files
     */
    appendUserAttachmentsBlock(messageDiv, files) {
      if (!messageDiv || !Array.isArray(files) || files.length === 0) return;
      let block = messageDiv.querySelector('.user-message-attachments');
      if (!block) {
        block = document.createElement('div');
        block.className = 'user-message-attachments';
        // Attachments sit above the message text.
        const textEl = messageDiv.querySelector('.user-message-text');
        if (textEl) messageDiv.insertBefore(block, textEl);
        else messageDiv.insertBefore(block, messageDiv.firstChild);
      }
      block.innerHTML = '';
      for (const f of files) {
        if (!f) continue;
        const type = String(f.type || '');

        // OWUI keeps image attachments intact (full-size) in the chat bubble
        // instead of shrinking them into a small chip/thumbnail.
        if (type === 'image' && f.url) {
          const figure = document.createElement('figure');
          figure.className = 'user-attachment-image-wrap';
          const img = document.createElement('img');
          img.className = 'user-attachment-image';
          img.alt = f.name || f.file?.meta?.name || '';
          img.loading = 'lazy';
          img.style.cursor = 'zoom-in';
          figure.appendChild(img);
          block.appendChild(figure);
          resolveAuthenticatedImageSrc(f.url).then((src) => {
            const resolved = src || f.url;
            img.src = resolved;
            img.addEventListener('click', () => openImageInNewTab(resolved, img.alt));
          });
          continue;
        }

        const chip = document.createElement('div');
        chip.className = 'user-attachment-chip';
        const label = f.name || f.file?.meta?.name || f.url || f.id || Neura.i18n.t('attachFile');

        const iconSpan = document.createElement('span');
        iconSpan.className = 'user-attachment-chip-icon';
        {
          const svgNS = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('width', '16');
          svg.setAttribute('height', '16');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('fill', 'none');
          svg.setAttribute('stroke', 'currentColor');
          svg.setAttribute('stroke-width', '1.75');
          svg.setAttribute('stroke-linecap', 'round');
          svg.setAttribute('stroke-linejoin', 'round');
          svg.setAttribute('aria-hidden', 'true');
          const isPage =
            type === 'text' ||
            type === 'web' ||
            type === 'page' ||
            type === 'youtube' ||
            f.context === 'page' ||
            f.context === 'full' ||
            !!f.sourceUrl;
          if (isPage) {
            // Live page mark: soft filled globe + twin sparks (not a flat document).
            svg.setAttribute('stroke-width', '1.5');
            svg.innerHTML =
              '<circle cx="11" cy="12" r="8.5" fill="currentColor" fill-opacity="0.18" stroke="currentColor"/>' +
              '<path d="M2.5 12h17"/>' +
              '<path d="M11 3.5c3.2 2.4 3.2 12.6 0 17"/>' +
              '<path d="M11 3.5c-3.2 2.4-3.2 12.6 0 17"/>' +
              '<path d="M18.2 5.2l.55 1.25 1.25.55-1.25.55-.55 1.25-.55-1.25-1.25-.55 1.25-.55z" fill="currentColor" stroke="none"/>' +
              '<path d="M20.4 8.6l.35.8.8.35-.8.35-.35.8-.35-.8-.8-.35.8-.35z" fill="currentColor" stroke="none" opacity="0.85"/>';
            chip.classList.add('user-attachment-chip--page');
          } else if (type === 'collection' || f.knowledge) {
            svg.innerHTML =
              '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>';
          } else {
            svg.innerHTML =
              '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>';
          }
          iconSpan.appendChild(svg);
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'user-attachment-chip-label';
        labelSpan.textContent = String(label);

        chip.appendChild(iconSpan);
        chip.appendChild(labelSpan);
        if (f.url && /^https?:/i.test(String(f.url))) chip.title = String(f.url);
        block.appendChild(chip);
      }
    },

    /**
     * Add one more attachment (e.g. a vision screenshot that finishes
     * uploading to OWUI after the user bubble is already on screen) onto the
     * user message's attachment block without wiping siblings already
     * rendered there by `appendUserAttachmentsBlock`. Renders images inline
     * exactly like OWUI does for natively-uploaded images.
     * @param {HTMLElement} messageDiv
     * @param {object} file OWUI file descriptor { type, id, url, name, ... }
     */
    appendSingleUserAttachment(messageDiv, file) {
      if (!messageDiv || !file) return;
      let block = messageDiv.querySelector('.user-message-attachments');
      if (!block) {
        block = document.createElement('div');
        block.className = 'user-message-attachments';
        const textEl = messageDiv.querySelector('.user-message-text');
        if (textEl) messageDiv.insertBefore(block, textEl);
        else messageDiv.insertBefore(block, messageDiv.firstChild);
      }
      const type = String(file.type || '');
      if (type === 'image' && file.url) {
        const figure = document.createElement('figure');
        figure.className = 'user-attachment-image-wrap';
        const img = document.createElement('img');
        img.className = 'user-attachment-image';
        img.alt = file.name || '';
        img.loading = 'lazy';
        img.style.cursor = 'zoom-in';
        figure.appendChild(img);
        block.appendChild(figure);
        resolveAuthenticatedImageSrc(file.url).then((src) => {
          const resolved = src || file.url;
          img.src = resolved;
          img.addEventListener('click', () => openImageInNewTab(resolved, img.alt));
        });
      }
    },

    appendActionsBar(wrapperEl, actions) {
      if (!wrapperEl || !Array.isArray(actions) || actions.length === 0) return;
      let bar = wrapperEl.querySelector('.neura-actions-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'neura-actions-bar';
        wrapperEl.appendChild(bar);
      }
      const seen = new Set(
        Array.from(bar.querySelectorAll('button')).map((b) => b.dataset.actionId || ''),
      );
      for (const a of actions) {
        if (!a) continue;
        const id = a.id || a.action_id || a.name || '';
        if (!id || seen.has(id)) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'neura-action-btn';
        btn.dataset.actionId = id;
        btn.textContent = a.name || a.label || id;
        if (a.description) btn.title = a.description;
        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: 'invokeAction', actionId: id, payload: a });
        });
        bar.appendChild(btn);
      }
    },

    /**
     * Renders Open WebUI's server-generated follow-up suggestions
     * (background_tasks.follow_up_generation) as clickable chips. Delivered
     * out-of-band via chrome.runtime message (see chat_follow_ups handler in
     * handlers/streaming.js), since they usually arrive after the turn's own
     * streaming port has already closed.
     * @param {HTMLElement} wrapperEl
     * @param {string[]} items
     */
    appendFollowUpsBlock(wrapperEl, items) {
      if (!wrapperEl || !Array.isArray(items) || items.length === 0) return;
      const existing = wrapperEl.querySelector('.neura-follow-ups-block');
      if (existing) existing.remove();

      const block = document.createElement('div');
      block.className = 'neura-follow-ups-block';
      for (const text of items) {
        const label = String(text || '').trim();
        if (!label) continue;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'neura-follow-up-chip';
        chip.textContent = label;
        chip.addEventListener('click', () => {
          block.remove();
          const messageInput = Neura.shadow.$('message-input');
          if (messageInput) messageInput.value = label;
          if (Neura.streaming) Neura.streaming.sendUserMessage();
        });
        block.appendChild(chip);
      }
      if (block.children.length > 0) wrapperEl.appendChild(block);
    },

    removeStatusChip(wrapperEl, opts) {
      if (!wrapperEl) return;
      const chip = wrapperEl.querySelector('.neura-status-chip');
      if (!chip) return;
      const immediate = !!(opts && opts.immediate);
      if (immediate) {
        chip.remove();
        return;
      }
      chip.classList.add('is-leaving');
      setTimeout(() => {
        if (chip.parentNode === wrapperEl) chip.remove();
      }, 400);
    },

    upsertThoughtBlock(wrapperEl, opts = {}) {
      return Neura.messages.ensureActiveThoughtBlock(wrapperEl, opts);
    },

    ensureActiveThoughtBlock(wrapperEl, opts = {}) {
      if (!wrapperEl) return null;
      let block = wrapperEl.querySelector('.neura-thought-block.is-active');
      if (!block) {
        block = createThoughtBlockEl(opts);
        insertBeforeMessageContent(wrapperEl, block);
      }

      if (opts.active != null) block.classList.toggle('is-active', !!opts.active);
      if (opts.waiting) {
        const label = block.querySelector('.neura-thought-label');
        if (label) label.textContent = Neura.i18n.t('thoughtActive');
      }
      bindThoughtBlockGuard(block);
      syncThoughtBlockContentState(block);
      return block;
    },

    startNextThoughtBlock(wrapperEl) {
      if (!wrapperEl) return null;
      const block = createThoughtBlockEl();
      insertBeforeMessageContent(wrapperEl, block);
      return block;
    },

    setThoughtContent(wrapperEl, thoughtText, opts = {}) {
      if (!wrapperEl || !thoughtText?.trim()) return null;
      const incoming = String(thoughtText).trim();
      const block = Neura.messages.ensureActiveThoughtBlock(wrapperEl, { active: true });
      if (!block) return null;

      const existing = (block._reasoningText || '').trim();
      if (!existing || incoming.length >= existing.length) {
        block._reasoningText = incoming;
      }

      const body = block.querySelector('.neura-thought-body');
      if (body) {
        if (body.dataset.placeholder === 'true') {
          delete body.dataset.placeholder;
        }
        body.textContent = Neura.markdown.normalizeThoughtText(block._reasoningText);
      }

      syncThoughtBlockContentState(block);
      if (opts.finalize !== false) {
        finalizeThoughtBlockElement(block, { collapse: opts.collapse !== false });
      } else if (thoughtBlockHasContent(block) && !userDecidedPanelState(block)) {
        block.open = true;
      }
      return block;
    },

    appendThoughtContent(wrapperEl, text) {
      if (!wrapperEl || !text) return;
      const block = Neura.messages.ensureActiveThoughtBlock(wrapperEl, { active: true });
      if (!block) return;

      const incoming = String(text);
      const existing = block._reasoningText || '';
      if (!existing) {
        block._reasoningText = incoming;
      } else if (incoming.startsWith(existing)) {
        block._reasoningText = incoming;
      } else if (existing.startsWith(incoming)) {
        /* stale/shorter snapshot */
      } else if (existing.includes(incoming)) {
        /* duplicate fragment already shown */
      } else if (incoming.includes(existing)) {
        block._reasoningText = incoming;
      } else {
        block._reasoningText = `${existing}${incoming}`;
      }

      const body = block.querySelector('.neura-thought-body');
      if (body) {
        if (body.dataset.placeholder === 'true') {
          body.textContent = '';
          delete body.dataset.placeholder;
        }
        body.textContent = Neura.markdown.normalizeThoughtText(block._reasoningText);
        body.scrollTop = body.scrollHeight;
      }
      syncThoughtBlockContentState(block);
      if (thoughtBlockHasContent(block) && !userDecidedPanelState(block)) block.open = true;
    },

    appendReasoningSegment(wrapperEl, text) {
      if (!wrapperEl || !text) return;
      const segments = expandReasoningSegments(text);
      const queue = segments.length ? segments : [String(text).trim()].filter(Boolean);
      for (const segment of queue) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        const toolMatch = trimmed.match(/^🔧\s*(.+)$/);
        if (toolMatch && !trimmed.includes('\n')) {
          const name = toolMatch[1].trim();
          Neura.messages.finalizeActiveThoughtBlock(wrapperEl, { collapse: true });
          const exploredEl = Neura.messages.appendExploredTool(wrapperEl, name, name);
          Neura.messages.reorderExploredBeforeLastThought(wrapperEl, exploredEl);
          Neura.messages.upsertToolResultBlock(wrapperEl, {
            name,
            callId: name,
            status: 'done',
          });
          continue;
        }
        Neura.messages.appendThoughtContent(wrapperEl, trimmed);
      }
    },

    renderPartitionedThoughtUi(wrapperEl, thoughtText) {
      if (!wrapperEl || !thoughtText?.trim()) return;
      const parts = expandReasoningSegments(thoughtText);
      let reasoningBatch = [];
      const flushReasoningBatch = () => {
        const merged = reasoningBatch.join('\n\n').trim();
        reasoningBatch = [];
        if (!merged) return;
        Neura.messages.appendThoughtContent(wrapperEl, merged);
      };
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const toolMatch = trimmed.match(/^🔧\s*(.+)$/);
        if (toolMatch && !trimmed.includes('\n')) {
          flushReasoningBatch();
          Neura.messages.finalizeActiveThoughtBlock(wrapperEl, { collapse: true });
          const name = toolMatch[1].trim();
          const exploredEl = Neura.messages.appendExploredTool(wrapperEl, name, name);
          Neura.messages.reorderExploredBeforeLastThought(wrapperEl, exploredEl);
          Neura.messages.upsertToolResultBlock(wrapperEl, {
            name,
            callId: name,
            status: 'done',
          });
          continue;
        }
        reasoningBatch.push(trimmed);
      }
      flushReasoningBatch();
      Neura.messages.finalizeActiveThoughtBlock(wrapperEl, { collapse: true });
      Neura.messages.dedupeThoughtBlocks(wrapperEl);
    },

    mergeThoughtFromDone(partitionedThought, streamReasoning) {
      const fromPartition = String(partitionedThought || '').trim();
      const fromStream = String(streamReasoning || '').trim();
      if (!fromPartition) return fromStream;
      if (!fromStream) return fromPartition;

      const partSegs = countThoughtSegments(fromPartition);
      const streamSegs = countThoughtSegments(fromStream);
      const partHasTools = fromPartition.includes('🔧');
      const streamHasTools = fromStream.includes('🔧');

      if (partHasTools && !streamHasTools) return fromPartition;
      if (streamHasTools && !partHasTools) return fromStream;
      if (partSegs > streamSegs) return fromPartition;
      if (streamSegs > partSegs) return fromStream;
      if (fromStream.includes(fromPartition)) return fromStream;
      if (fromPartition.includes(fromStream)) return fromPartition;
      return `${fromPartition}\n\n${fromStream}`;
    },

    buildStructuredThoughtText(timeline) {
      return buildStructuredThoughtText(timeline);
    },

    countThoughtSegments(text) {
      return countThoughtSegments(text);
    },

    expandReasoningSegments(text) {
      return expandReasoningSegments(text);
    },

    rebuildPartitionedThoughtUi(wrapperEl, thoughtText) {
      if (!wrapperEl || !thoughtText?.trim()) return;
      wrapperEl
        .querySelectorAll(
          '.neura-thought-block, .neura-explored-block, .neura-explored-tools, .neura-tool-result-block',
        )
        .forEach((block) => block.remove());
      Neura.messages.renderPartitionedThoughtUi(wrapperEl, thoughtText);
    },

    reorderExploredBeforeLastThought(wrapperEl, exploredBlock) {
      reorderExploredBeforeLastThought(wrapperEl, exploredBlock);
    },

    appendExploredTool(wrapperEl, name, callId) {
      if (!wrapperEl || !name) return null;
      const id = String(callId || name).trim() || name;
      const existing = wrapperEl.querySelector(
        `.neura-explored-block[data-call-id="${CSS.escape(id)}"]`,
      );
      if (existing) return existing;

      const block = document.createElement('details');
      block.className = 'neura-explored-block is-done';
      block.dataset.callId = id;
      block.dataset.toolName = name;
      block.open = false;

      const summary = document.createElement('summary');
      summary.className = 'neura-explored-summary';

      const label = document.createElement('span');
      label.className = 'neura-explored-label';
      label.textContent = Neura.i18n.t('exploredTool', name);
      summary.appendChild(label);
      block.appendChild(summary);

      insertBeforeMessageContent(wrapperEl, block);
      return block;
    },

    upsertToolResultBlock(wrapperEl, { name, status, callId, output } = {}) {
      if (!wrapperEl) return;
      const id = callId || name || `tool_${Date.now()}`;
      let block = wrapperEl.querySelector(
        `.neura-tool-result-block[data-call-id="${CSS.escape(id)}"]`,
      );
      if (!block) {
        block = document.createElement('details');
        block.className = 'neura-tool-result-block';
        block.dataset.callId = id;
        if (name) block.dataset.toolName = name;

        const summary = document.createElement('summary');
        summary.className = 'neura-tool-result-summary';

        const check = document.createElement('span');
        check.className = 'neura-step-check is-pending';
        check.setAttribute('aria-hidden', 'true');
        summary.appendChild(check);

        const label = document.createElement('span');
        label.className = 'neura-tool-result-label';
        summary.appendChild(label);

        const chevron = document.createElement('span');
        chevron.className = 'neura-step-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        summary.appendChild(chevron);

        block.appendChild(summary);
        insertBeforeMessageContent(wrapperEl, block);
      }
      bindUserToggleIntent(block);

      const toolName = name || block.dataset.toolName || Neura.i18n.t('ellipsis');
      if (name) block.dataset.toolName = name;
      const label = block.querySelector('.neura-tool-result-label');
      const check = block.querySelector('.neura-step-check');

      if (status === 'running') {
        block.classList.add('is-running');
        block.classList.remove('is-done');
        if (check) {
          check.classList.remove('is-done');
          check.classList.add('is-pending');
        }
        if (label) label.textContent = Neura.i18n.t('toolRunning', toolName);
      } else {
        block.classList.remove('is-running');
        block.classList.add('is-done');
        if (check) {
          check.classList.remove('is-pending');
          check.classList.add('is-done');
        }
        if (label) label.textContent = Neura.i18n.t('viewToolResult', toolName);
      }
      if (!userDecidedPanelState(block)) block.open = false;

      if (output != null && String(output).trim()) {
        let body = block.querySelector('.neura-tool-result-body');
        if (!body) {
          body = document.createElement('pre');
          body.className = 'neura-tool-result-body';
          block.appendChild(body);
        }
        body.textContent = String(output);
      }
    },

    finalizeActiveThoughtBlock(wrapperEl, opts = {}) {
      if (!wrapperEl) return;
      const block = wrapperEl.querySelector('.neura-thought-block.is-active');
      if (block) finalizeThoughtBlockElement(block, opts);
    },

    finalizeAllThoughtBlocks(wrapperEl, opts = {}) {
      if (!wrapperEl) return;
      wrapperEl.querySelectorAll('.neura-thought-block.is-active').forEach((block) => {
        finalizeThoughtBlockElement(block, opts);
      });
      Neura.messages.dedupeThoughtBlocks(wrapperEl);
      Neura.messages.finalizePendingToolResults(wrapperEl);
    },

    finalizePendingToolResults(wrapperEl) {
      if (!wrapperEl) return;
      wrapperEl.querySelectorAll('.neura-tool-result-block.is-running').forEach((block) => {
        Neura.messages.upsertToolResultBlock(wrapperEl, {
          name: block.dataset.toolName,
          callId: block.dataset.callId,
          status: 'done',
        });
      });
    },

    dedupeThoughtBlocks(wrapperEl) {
      dedupeThoughtBlocks(wrapperEl);
    },

    finalizeThoughtBlock(wrapperEl, opts = {}) {
      Neura.messages.finalizeActiveThoughtBlock(wrapperEl, opts);
    },

    clearThoughtSequence(wrapperEl) {
      if (!wrapperEl) return;
      wrapperEl
        .querySelectorAll(
          '.neura-thought-block, .neura-explored-block, .neura-explored-tools, .neura-tool-result-block',
        )
        .forEach((el) => el.remove());
    },

    removeThoughtBlock(wrapperEl) {
      if (!wrapperEl) return;
      wrapperEl.querySelectorAll('.neura-thought-block').forEach((block) => block.remove());
    },

    ensureAuxiliarySlot(wrapperEl, slotClass) {
      if (!wrapperEl) return null;
      const contentDiv = wrapperEl.querySelector('.message-content');
      if (!contentDiv) return null;
      let slot = wrapperEl.querySelector(`.${slotClass}`);
      if (!slot) {
        slot = document.createElement('div');
        slot.className = slotClass;
        wrapperEl.insertBefore(slot, contentDiv);
      }
      return slot;
    },

    appendToolCallChip(wrapperEl, { name, status, callId, output }) {
      Neura.messages.upsertToolResultBlock(wrapperEl, { name, status, callId, output });
    },

    appendCodeInterpreterBlock(wrapperEl, { code, language, output }) {
      if (!wrapperEl) return;
      const contentDiv = wrapperEl.querySelector('.message-content');
      if (!contentDiv) return;

      const block = document.createElement('details');
      block.className = 'neura-code-interpreter';
      block.open = true;

      const summary = document.createElement('summary');
      summary.className = 'neura-code-interpreter-label';
      summary.textContent = Neura.i18n.t('codeInterpreterBlock', language || 'python');
      block.appendChild(summary);

      if (code) {
        const pre = document.createElement('pre');
        pre.className = 'neura-code-interpreter-code';
        pre.textContent = code;
        block.appendChild(pre);
      }
      if (output) {
        const out = document.createElement('pre');
        out.className = 'neura-code-interpreter-output';
        out.textContent = output;
        block.appendChild(out);
      }

      wrapperEl.insertBefore(block, contentDiv);
    },

    appendUsageFooter(wrapperEl, usage) {
      if (!wrapperEl || !usage) return;
      const total = usage.total_tokens ?? usage.totalTokens;
      if (total == null) return;

      let footer = wrapperEl.querySelector('.neura-usage-footer');
      if (!footer) {
        footer = document.createElement('div');
        footer.className = 'neura-usage-footer';
        wrapperEl.appendChild(footer);
      }
      footer.textContent = Neura.i18n.t('usageTokens', total);
    },

    showStreamErrorBanner(message) {
      const chatWindow = Neura.shadow.$('chat-window');
      const inputWrapper = Neura.shadow.$('input-wrapper');
      if (!chatWindow || !inputWrapper) return;

      let banner = chatWindow.querySelector('.neura-stream-error');
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'neura-stream-error';
        banner.setAttribute('role', 'alert');
        chatWindow.insertBefore(banner, inputWrapper);
      }
      banner.textContent = message || Neura.i18n.t('streamErrorGeneric');
      banner.hidden = false;
    },

    clearStreamErrorBanner() {
      const chatWindow = Neura.shadow.$('chat-window');
      const banner = chatWindow && chatWindow.querySelector('.neura-stream-error');
      if (banner) banner.hidden = true;
    },

    attachAssistantActions(messageContainer, text) {
      attachAssistantCopy(messageContainer, text);
    },
  };
})(window.Neura);
