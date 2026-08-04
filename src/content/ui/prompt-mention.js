(function (Neura) {
  // "/" slash-command picker: typing "/" as the entire input opens saved
  // Open WebUI prompts; selecting one inserts the prompt content into the
  // composer (variables like {{name}} are left for the user to fill).
  const TRIGGER_RE = /^\/(\S*)$/;

  let dropdownEl = null;
  let listEl = null;
  let prompts = null;
  let loadingPromise = null;
  let filtered = [];
  let activeIndex = 0;
  let isOpen = false;
  let searchTimer = null;

  function sendAction(action, extra = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action, ...extra }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, items: [], data: [] });
            return;
          }
          resolve(res || { ok: false, items: [], data: [] });
        });
      } catch (e) {
        resolve({ ok: false, items: [], data: [] });
      }
    });
  }

  function loadPrompts(query) {
    if (loadingPromise) return loadingPromise;
    loadingPromise = sendAction('owui:searchPrompts', { query: query || '' }).then((res) => {
      loadingPromise = null;
      const items = res.items || res.data || [];
      if (!query) prompts = items;
      return items;
    });
    return loadingPromise;
  }

  function ensureDropdown() {
    if (dropdownEl) return dropdownEl;
    const composerBox = Neura.shadow.$('composer-box');
    if (!composerBox) return null;

    dropdownEl = document.createElement('div');
    dropdownEl.id = 'prompt-mention-dropdown';
    dropdownEl.className = 'model-mention-dropdown';
    dropdownEl.setAttribute('role', 'listbox');

    listEl = document.createElement('div');
    listEl.className = 'model-mention-list';
    dropdownEl.appendChild(listEl);

    composerBox.insertBefore(dropdownEl, composerBox.firstChild);
    return dropdownEl;
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'model-mention-empty';
      empty.textContent = Neura.i18n.t('promptMentionEmpty');
      listEl.appendChild(empty);
      return;
    }

    filtered.forEach((prompt, idx) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'model-mention-item';
      item.dataset.index = String(idx);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', idx === activeIndex ? 'true' : 'false');
      item.classList.toggle('active', idx === activeIndex);

      const cmd = document.createElement('span');
      cmd.className = 'prompt-mention-command';
      cmd.textContent = prompt.command || '/';
      const title = document.createElement('span');
      title.className = 'prompt-mention-title';
      title.textContent = prompt.title || '';
      item.appendChild(cmd);
      item.appendChild(title);

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectPrompt(prompt);
      });
      item.addEventListener('mouseenter', () => {
        activeIndex = idx;
        highlightActive();
      });

      listEl.appendChild(item);
    });
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

  function applyFilter(query, source) {
    const q = String(query || '').trim().toLowerCase();
    const list = source || prompts || [];
    filtered = q
      ? list.filter(
          (p) =>
            (p.command || '').toLowerCase().includes(q) ||
            (p.title || '').toLowerCase().includes(q) ||
            (p.content || '').toLowerCase().includes(q),
        )
      : list.slice();
    activeIndex = 0;
    renderList();
  }

  function openDropdown(query) {
    const el = ensureDropdown();
    if (!el) return;
    isOpen = true;
    el.classList.add('open');

    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (!isOpen) return;
      loadPrompts(query).then((items) => {
        if (!isOpen) return;
        applyFilter(query, items);
      });
    }, 120);

    if (prompts) applyFilter(query, prompts);
    else {
      filtered = [];
      renderList();
    }
  }

  function closeDropdown() {
    isOpen = false;
    if (dropdownEl) dropdownEl.classList.remove('open');
  }

  function selectPrompt(prompt) {
    closeDropdown();
    const input = Neura.shadow.$('message-input');
    if (!input) return;
    const content = String(prompt?.content || '').trim();
    input.value = content || '';
    if (Neura.input) Neura.input.autoResizeTextarea(input);
    input.focus();
    try {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    } catch (e) {
      /* ignore */
    }
  }

  function handleInput() {
    // Slash prompts only apply in the normal chat composer — not notes.
    if (Neura.state?.panelMode === 'note') {
      if (isOpen) closeDropdown();
      return;
    }
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
      if (filtered.length > 0) activeIndex = (activeIndex + 1) % filtered.length;
      highlightActive();
      return true;
    }
    if (ev.key === 'ArrowUp') {
      if (filtered.length > 0) activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
      highlightActive();
      return true;
    }
    if (ev.key === 'Enter' || ev.key === 'Tab') {
      if (filtered[activeIndex]) selectPrompt(filtered[activeIndex]);
      else closeDropdown();
      return true;
    }
    if (ev.key === 'Escape') {
      closeDropdown();
      return true;
    }
    return false;
  }

  Neura.promptMention = {
    isOpen: () => isOpen,
    handleKeydown,
    handleInput,
    close: closeDropdown,

    init() {
      const input = Neura.shadow.$('message-input');
      if (!input) return;
      input.addEventListener('blur', closeDropdown);
    },
  };
})(window.Neura);
