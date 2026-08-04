(function (Neura) {
  // "#knowledge" mention picker in the composer, mirroring the Open WebUI
  // webapp: typing "#" as the very first character of the message opens a
  // dropdown grouped into "Collections" (knowledge bases) and "Files"
  // (files that belong to those knowledge bases). Picking one attaches it
  // to the next message as a removable chip; the attachment travels to the
  // server in the chat completion payload's `files` array (SPEC.md
  // §3.4/3.5).
  //
  // Data source: results come from the server-side search endpoints
  // (`GET /api/v1/knowledge/search` and `GET /api/v1/knowledge/search/files`)
  // as the user types, debounced — the exact same approach used by the Open
  // WebUI webapp (`src/lib/components/chat/MessageInput/Commands/Knowledge.svelte`)
  // and by Conduit (`conduit/lib/features/chat/widgets/modern_chat_input.dart`,
  // `api.searchKnowledgeBases()` / `api.searchKnowledgeFiles()`). Loading
  // everything once via the plain list endpoints and filtering client-side
  // doesn't match what the webapp shows and silently breaks once results
  // are paginated.
  const TRIGGER_RE = /^#(\S*)$/;
  const DEBOUNCE_MS = 200;

  let dropdownEl = null;
  let listEl = null;
  let filteredCollections = [];
  let filteredFiles = [];
  let flatItems = []; // flattened, in render order, for keyboard navigation
  let activeIndex = 0;
  let isOpen = false;
  let debounceTimer = null;
  let requestSeq = 0; // guards against stale (out-of-order) search responses

  function sendAction(action, extra = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action, ...extra }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message, data: [] });
          return;
        }
        resolve(response || { data: [] });
      });
    });
  }

  function normalizeCollections(list) {
    return (Array.isArray(list) ? list : [])
      .map((kb) => {
        if (!kb || typeof kb !== 'object') return null;
        const id = kb.id != null ? String(kb.id) : '';
        if (!id) return null;
        return { kind: 'collection', id, name: String(kb.name || id) };
      })
      .filter(Boolean);
  }

  function normalizeFiles(list) {
    return (Array.isArray(list) ? list : [])
      .map((f) => {
        if (!f || typeof f !== 'object') return null;
        const id = f.id != null ? String(f.id) : '';
        if (!id) return null;
        const name = f.filename || f.meta?.name || f.name || id;
        const collection = f.collection && typeof f.collection === 'object' ? f.collection : null;
        const collectionId = collection?.id != null ? String(collection.id) : '';
        const collectionName = collection?.name ? String(collection.name) : '';
        return {
          kind: 'file',
          id,
          name: String(name),
          collectionId,
          collectionName,
        };
      })
      .filter(Boolean);
  }

  function ensureDropdown() {
    if (dropdownEl) return dropdownEl;
    const composerBox = Neura.shadow.$('composer-box');
    if (!composerBox) return null;

    dropdownEl = document.createElement('div');
    dropdownEl.id = 'knowledge-mention-dropdown';
    dropdownEl.className = 'model-mention-dropdown knowledge-mention-dropdown';
    dropdownEl.setAttribute('role', 'listbox');

    listEl = document.createElement('div');
    listEl.className = 'model-mention-list';
    dropdownEl.appendChild(listEl);

    composerBox.insertBefore(dropdownEl, composerBox.firstChild);
    return dropdownEl;
  }

  function appendSection(label) {
    const section = document.createElement('div');
    section.className = 'model-mention-section';
    section.textContent = label;
    listEl.appendChild(section);
  }

  function appendItem(item, flatIdx) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'model-mention-item';
    button.dataset.index = String(flatIdx);
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', flatIdx === activeIndex ? 'true' : 'false');
    button.classList.toggle('active', flatIdx === activeIndex);

    const icon = document.createElement('span');
    icon.className = 'model-mention-item-icon';
    icon.textContent = item.kind === 'collection' ? '\u{1F5C4}\uFE0F' : '\u{1F4C4}';

    const labelWrap = document.createElement('span');
    labelWrap.className = 'model-mention-item-label-wrap';

    const label = document.createElement('span');
    label.className = 'model-mention-item-label';
    label.textContent = item.name;
    labelWrap.appendChild(label);

    if (item.kind === 'file' && item.collectionName) {
      const sub = document.createElement('span');
      sub.className = 'model-mention-item-sublabel';
      sub.textContent = item.collectionName;
      labelWrap.appendChild(sub);
    }

    button.appendChild(icon);
    button.appendChild(labelWrap);

    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectItem(item);
    });
    button.addEventListener('mouseenter', () => {
      activeIndex = flatIdx;
      highlightActive();
    });

    listEl.appendChild(button);
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';
    flatItems = [...filteredCollections, ...filteredFiles];

    if (flatItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'model-mention-empty';
      empty.textContent = Neura.i18n.t('knowledgeMentionEmpty');
      listEl.appendChild(empty);
      return;
    }

    let idx = 0;
    if (filteredCollections.length > 0) {
      appendSection(Neura.i18n.t('knowledgeMentionCollections'));
      for (const item of filteredCollections) appendItem(item, idx++);
    }
    if (filteredFiles.length > 0) {
      appendSection(Neura.i18n.t('knowledgeMentionFiles'));
      for (const item of filteredFiles) appendItem(item, idx++);
    }
  }

  function highlightActive() {
    if (!listEl) return;
    const items = listEl.querySelectorAll('.model-mention-item');
    items.forEach((el) => {
      const active = Number(el.dataset.index) === activeIndex;
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const activeEl = listEl.querySelector('.model-mention-item.active');
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Fetches search results for the given query from the server, mirroring
   * the parallel `Future.wait` in Conduit's `_fetchContextSuggestions()`.
   * @param {string} query
   */
  function runSearch(query) {
    const seq = ++requestSeq;
    Promise.all([
      sendAction('owui:searchKnowledgeBases', { query }),
      sendAction('owui:searchKnowledgeFiles', { query }),
    ]).then(([kbResponse, filesResponse]) => {
      // Discard stale responses: the user may have kept typing (or closed
      // the dropdown) while this request was in flight.
      if (seq !== requestSeq || !isOpen) return;
      filteredCollections = normalizeCollections(kbResponse?.data);
      filteredFiles = normalizeFiles(filesResponse?.data);
      activeIndex = 0;
      renderList();
    });
  }

  function scheduleSearch(query) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
  }

  function openDropdown(query) {
    const el = ensureDropdown();
    if (!el) return;
    isOpen = true;
    el.classList.add('open');
    scheduleSearch(query);
  }

  function closeDropdown() {
    isOpen = false;
    requestSeq += 1; // invalidate any in-flight search
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (dropdownEl) dropdownEl.classList.remove('open');
  }

  function selectItem(item) {
    closeDropdown();

    const input = Neura.shadow.$('message-input');
    if (input) {
      input.value = '';
      if (Neura.input) Neura.input.autoResizeTextarea(input);
      input.focus();
    }

    // Conduit-aligned: KB files use knowledge:true + collection_name = KB name.
    if (Neura.fileAttachments && typeof Neura.fileAttachments.addKnowledgeItem === 'function') {
      if (item.kind === 'collection') {
        Neura.fileAttachments.addKnowledgeItem({
          kind: 'collection',
          id: item.id,
          name: item.name,
        });
      } else {
        Neura.fileAttachments.addKnowledgeItem({
          kind: 'file',
          id: item.id,
          name: item.name,
          knowledge: true,
          // Conduit: prefer KB display name for collection_name on knowledge files.
          collectionName: item.collectionName || item.collectionId || '',
          collectionId: item.collectionId || '',
        });
      }
    }
  }

  function handleInput() {
    const input = Neura.shadow.$('message-input');
    if (!input) return;
    const match = TRIGGER_RE.exec(input.value);
    if (match) {
      openDropdown(match[1]);
    } else if (isOpen) {
      closeDropdown();
    }
  }

  function handleKeydown(ev) {
    if (!isOpen) return false;

    if (ev.key === 'ArrowDown') {
      if (flatItems.length > 0) activeIndex = (activeIndex + 1) % flatItems.length;
      highlightActive();
      return true;
    }
    if (ev.key === 'ArrowUp') {
      if (flatItems.length > 0) activeIndex = (activeIndex - 1 + flatItems.length) % flatItems.length;
      highlightActive();
      return true;
    }
    if (ev.key === 'Enter' || ev.key === 'Tab') {
      if (flatItems[activeIndex]) selectItem(flatItems[activeIndex]);
      else closeDropdown();
      return true;
    }
    if (ev.key === 'Escape') {
      closeDropdown();
      return true;
    }
    return false;
  }

  Neura.knowledgeMention = {
    isOpen: () => isOpen,
    handleKeydown,
    handleInput,
    close: closeDropdown,

    /**
     * @returns {Array<{ type: string, id: string, name: string, [key: string]: unknown }>}
     */
    getPendingAttachments() {
      if (Neura.fileAttachments) return Neura.fileAttachments.getPendingAttachments();
      return [];
    },

    clearPendingAttachments() {
      if (Neura.fileAttachments) Neura.fileAttachments.clearPendingAttachments();
    },

    init() {
      // Note: the "input" event on #message-input is driven from
      // keyboard-isolation.js (window-level capture handler) — see the
      // comment there for why a listener attached here would never fire.
      const input = Neura.shadow.$('message-input');
      if (!input) return;
      input.addEventListener('blur', closeDropdown);
      if (Neura.fileAttachments) Neura.fileAttachments.renderChips();
    },
  };
})(window.Neura);
