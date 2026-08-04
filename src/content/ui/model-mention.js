(function (Neura) {
  // "@model" mention picker in the composer, mirroring the Open WebUI
  // webapp: typing "@" as the very first character of the message opens a
  // dropdown of the available models; picking one switches the active
  // model (same storage key used by the header <select>) and clears the
  // "@query" text so the user can type their message normally.
  const TRIGGER_RE = /^@(\S*)$/;

  let dropdownEl = null;
  let listEl = null;
  let models = null; // cached [{ id, name }] once loaded
  let loadingPromise = null;
  let filtered = [];
  let activeIndex = 0;
  let isOpen = false;

  function loadModels() {
    if (models) return Promise.resolve(models);
    if (loadingPromise) return loadingPromise;

    loadingPromise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getAvailableModels' }, (response) => {
        loadingPromise = null;
        if (chrome.runtime.lastError || !response || response.error) {
          resolve([]);
          return;
        }
        const preferId = (() => {
          try {
            // Sync with header select if present
            const select = Neura.shadow && Neura.shadow.$('header-model-select');
            return select && select.value ? select.value : '';
          } catch {
            return '';
          }
        })();
        models =
          Neura.modelsList && typeof Neura.modelsList.modelsFromPayload === 'function'
            ? Neura.modelsList.modelsFromPayload(response.data, preferId)
            : [];
        resolve(models);
      });
    });
    return loadingPromise;
  }

  function ensureDropdown() {
    if (dropdownEl) return dropdownEl;
    const composerBox = Neura.shadow.$('composer-box');
    if (!composerBox) return null;

    dropdownEl = document.createElement('div');
    dropdownEl.id = 'model-mention-dropdown';
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
      empty.textContent = Neura.i18n.t('modelMentionEmpty');
      listEl.appendChild(empty);
      return;
    }

    filtered.forEach((model, idx) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'model-mention-item';
      item.dataset.index = String(idx);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', idx === activeIndex ? 'true' : 'false');
      item.classList.toggle('active', idx === activeIndex);

      const icon = document.createElement('img');
      icon.className = 'model-mention-item-icon';
      icon.alt = '';
      icon.draggable = false;
      icon.src = Neura.paths?.iconWhite || '';
      if (Neura.modelIcons) {
        Neura.modelIcons.applyToImg(icon, model.id, model.profileImageUrl);
      }

      const label = document.createElement('span');
      label.className = 'model-mention-item-label';
      label.textContent = model.name;

      item.appendChild(icon);
      item.appendChild(label);

      // mousedown (not click) + preventDefault so the textarea never loses
      // focus when picking with the mouse.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectModel(model);
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

  function applyFilter(query) {
    const q = String(query || '').trim().toLowerCase();
    const source = models || [];
    filtered = q
      ? source.filter(
          (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
        )
      : source;
    activeIndex = 0;
    renderList();
  }

  function openDropdown(query) {
    const el = ensureDropdown();
    if (!el) return;
    isOpen = true;
    el.classList.add('open');

    if (models) {
      applyFilter(query);
    } else {
      filtered = [];
      renderList();
      loadModels().then((list) => {
        if (!isOpen) return;
        models = list;
        applyFilter(query);
      });
    }
  }

  function closeDropdown() {
    isOpen = false;
    if (dropdownEl) dropdownEl.classList.remove('open');
  }

  async function selectModel(model) {
    closeDropdown();

    const input = Neura.shadow.$('message-input');
    if (input) {
      input.value = '';
      if (Neura.input) Neura.input.autoResizeTextarea(input);
      input.focus();
    }

    if (Neura.ui && typeof Neura.ui.applyHeaderModel === 'function') {
      Neura.ui.applyHeaderModel(model.id);
      return;
    }

    await new Promise((resolve) => {
      chrome.storage.sync.set({ neuraModel: model.id }, resolve);
    });

    const select = Neura.shadow.$('header-model-select');
    if (select && [...select.options].some((o) => o.value === model.id)) {
      select.value = model.id;
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
      if (filtered[activeIndex]) selectModel(filtered[activeIndex]);
      else closeDropdown();
      return true;
    }
    if (ev.key === 'Escape') {
      closeDropdown();
      return true;
    }
    return false;
  }

  Neura.modelMention = {
    isOpen: () => isOpen,
    handleKeydown,
    handleInput,
    close: closeDropdown,

    init() {
      // Note: the "input" event on #message-input is driven from
      // keyboard-isolation.js (window-level capture handler), not from a
      // listener attached here — see the comment there for why.
      const input = Neura.shadow.$('message-input');
      if (!input) return;
      input.addEventListener('blur', closeDropdown);
    },
  };
})(window.Neura);
