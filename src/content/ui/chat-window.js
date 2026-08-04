(function (Neura) {
  Neura.ui = Neura.ui || {};

  function sendRuntimeMessage(message, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Background timeout')), timeoutMs);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response || {});
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  function fillModelSelectFallback(select, stored, hint) {
    select.innerHTML = '';
    if (hint) {
      const errOpt = document.createElement('option');
      errOpt.textContent = hint;
      errOpt.disabled = true;
      select.appendChild(errOpt);
    }
    const opt = document.createElement('option');
    opt.value = stored;
    opt.textContent = stored;
    opt.selected = true;
    select.appendChild(opt);
  }

  function setupComposerDropdownMenus() {
    const inputMenuBtn = Neura.shadow.$('input-menu-btn');
    const inputMenuDropdown = Neura.shadow.$('input-menu-dropdown');
    const integrationsMenuBtn = Neura.shadow.$('integrations-menu-btn');
    const integrationsMenuDropdown = Neura.shadow.$('integrations-menu-dropdown');
    const agentMenuBtn = Neura.shadow.$('agent-menu-btn');
    const agentMenuDropdown = Neura.shadow.$('agent-menu-dropdown');

    function closeAllComposerMenus() {
      inputMenuDropdown?.classList.remove('open');
      integrationsMenuDropdown?.classList.remove('open');
      agentMenuDropdown?.classList.remove('open');
    }

    function isComposerMenuOpen() {
      return (
        !!inputMenuDropdown?.classList.contains('open') ||
        !!integrationsMenuDropdown?.classList.contains('open') ||
        !!agentMenuDropdown?.classList.contains('open')
      );
    }

    function isInsideComposerMenu(node) {
      if (!(node instanceof Element)) return false;
      return !!node.closest?.('.composer-menu');
    }

    inputMenuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeHeaderModelDropdown();
      closeActiveToolsDropdown();
      const willOpen = !inputMenuDropdown?.classList.contains('open');
      closeAllComposerMenus();
      if (willOpen) inputMenuDropdown?.classList.add('open');
    });

    integrationsMenuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeHeaderModelDropdown();
      closeActiveToolsDropdown();
      const willOpen = !integrationsMenuDropdown?.classList.contains('open');
      closeAllComposerMenus();
      if (willOpen) integrationsMenuDropdown?.classList.add('open');
    });

    agentMenuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeHeaderModelDropdown();
      closeActiveToolsDropdown();
      const willOpen = !agentMenuDropdown?.classList.contains('open');
      closeAllComposerMenus();
      if (willOpen) agentMenuDropdown?.classList.add('open');
    });

    document.addEventListener(
      'click',
      (e) => {
        if (!isComposerMenuOpen()) return;
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
        if (path.some(isInsideComposerMenu)) return;
        closeAllComposerMenus();
      },
      true,
    );

    Neura.ui.closeComposerMenus = closeAllComposerMenus;
  }

  function wrapIntegrationsMenuRow(toggleBtn) {
    const row = document.createElement('div');
    row.className = 'integrations-menu-row';
    toggleBtn.classList.add('integrations-menu-toggle');
    row.appendChild(toggleBtn);
    return row;
  }

  function buildComposerMenuItemContent(iconSvg, label, description) {
    return (
      `<span class="composer-menu-item-icon" aria-hidden="true">${iconSvg}</span>` +
      `<span class="composer-menu-item-text">` +
      `<span class="composer-menu-item-name">${label}</span>` +
      `<span class="composer-menu-item-desc">${description}</span>` +
      `</span>`
    );
  }

  function sortMenuRowsAlphabetically(container, rowSelector) {
    if (!container) return;
    const rows = Array.from(container.querySelectorAll(rowSelector));
    rows
      .sort((a, b) => {
        const nameA = a.querySelector('.composer-menu-item-name')?.textContent || '';
        const nameB = b.querySelector('.composer-menu-item-name')?.textContent || '';
        return nameA.trim().localeCompare(nameB.trim(), undefined, { sensitivity: 'base' });
      })
      .forEach((row) => container.appendChild(row));
  }

  function fillModelSelectFallback(select, stored, hint) {
    select.innerHTML = '';
    if (hint) {
      const errOpt = document.createElement('option');
      errOpt.textContent = hint;
      errOpt.disabled = true;
      select.appendChild(errOpt);
    }
    const opt = document.createElement('option');
    opt.value = stored;
    opt.textContent = stored;
    opt.selected = true;
    select.appendChild(opt);
    renderHeaderModelList([{ id: stored, name: stored }], stored);
    updateHeaderModelLabel(stored);
  }

  function updateHeaderModelLabel(modelId) {
    const label = Neura.shadow.$('header-model-label');
    const select = Neura.shadow.$('header-model-select');
    const trigger = Neura.shadow.$('header-model-trigger');
    if (!label) return;

    let name = '';
    if (select?.value) {
      const selected = select.selectedOptions?.[0];
      name = String(selected?.textContent || '').trim();
    }
    if (!name && modelId) name = String(modelId);
    if (!name && select?.value) name = String(select.value);
    if (!name) name = Neura.i18n.t('loadModels');

    label.textContent = name;
    const resolvedId = modelId || select?.value || '';
    if (resolvedId) {
      label.dataset.modelId = resolvedId;
    }

    if (trigger && resolvedId && Neura.modelIcons) {
      let icon = trigger.querySelector('img.header-model-icon');
      if (!icon) {
        icon = document.createElement('img');
        icon.className = 'header-model-icon';
        icon.alt = '';
        icon.draggable = false;
        trigger.insertBefore(icon, label);
      }
      const profileImageUrl = findModelProfileImageUrl(resolvedId);
      icon.src = Neura.branding?.getAssistantIconSrc?.() || Neura.paths?.iconWhite || '';
      Neura.modelIcons.applyToImg(icon, resolvedId, profileImageUrl);
      Neura.modelIcons.setActiveModel(resolvedId);
      Neura.modelIcons.refreshActive(resolvedId, profileImageUrl);
    }
  }

  function findModelProfileImageUrl(modelId) {
    const list = Neura.state?.headerModels;
    if (!Array.isArray(list)) return null;
    const hit = list.find((m) => m && m.id === modelId);
    return hit?.profileImageUrl || null;
  }

  function renderHeaderModelList(list, selectedId) {
    const modelList = Neura.shadow.$('header-model-list');
    if (!modelList) return;
    modelList.innerHTML = '';
    Neura.state = Neura.state || {};
    Neura.state.headerModels = Array.isArray(list) ? list : [];

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'header-model-empty';
      empty.textContent = Neura.i18n.t('modelMentionEmpty');
      modelList.appendChild(empty);
      return;
    }

    for (const model of list) {
      const id = model?.id;
      if (!id) continue;
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'header-model-option';
      option.dataset.modelId = id;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', id === selectedId ? 'true' : 'false');
      option.classList.toggle('active', id === selectedId);

      const icon = document.createElement('img');
      icon.className = 'header-model-option-icon';
      icon.alt = '';
      icon.draggable = false;
      icon.src = Neura.paths?.iconWhite || '';
      if (Neura.modelIcons) {
        Neura.modelIcons.applyToImg(icon, id, model.profileImageUrl);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'header-model-option-label';
      nameSpan.textContent = model.name || id;

      option.appendChild(icon);
      option.appendChild(nameSpan);
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        closeHeaderModelDropdown();
        applyHeaderModel(id);
      });
      modelList.appendChild(option);
    }
  }

  function openHeaderModelDropdown() {
    const picker = Neura.shadow.$('header-model-picker');
    const trigger = Neura.shadow.$('header-model-trigger');
    const dropdown = Neura.shadow.$('header-model-dropdown');
    if (!picker || !dropdown) return;
    Neura.ui.closeComposerMenus?.();
    picker.classList.add('open');
    dropdown.hidden = false;
    trigger?.setAttribute('aria-expanded', 'true');
  }

  function closeHeaderModelDropdown() {
    const picker = Neura.shadow.$('header-model-picker');
    const trigger = Neura.shadow.$('header-model-trigger');
    const dropdown = Neura.shadow.$('header-model-dropdown');
    picker?.classList.remove('open');
    if (dropdown) dropdown.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  }

  function applyHeaderModel(modelId, { refreshFeatures = true } = {}) {
    if (!modelId) return;
    const select = Neura.shadow.$('header-model-select');
    if (select && [...select.options].some((o) => o.value === modelId)) {
      select.value = modelId;
    }
    updateHeaderModelLabel(modelId);
    Neura.shadow.$('header-model-list')?.querySelectorAll('.header-model-option').forEach((el) => {
      const active = el.dataset.modelId === modelId;
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    chrome.storage.sync.set({ neuraModel: modelId }, () => {
      if (refreshFeatures) refreshFeatureToggles(modelId);
    });
  }

  function setupHeaderModelPicker() {
    const picker = Neura.shadow.$('header-model-picker');
    const trigger = Neura.shadow.$('header-model-trigger');
    if (!picker || !trigger) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !picker.classList.contains('open');
      closeHeaderModelDropdown();
      if (willOpen) openHeaderModelDropdown();
    });

    document.addEventListener(
      'click',
      (e) => {
        if (!picker.classList.contains('open')) return;
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
        if (path.some((node) => node instanceof Element && node.closest?.('#header-model-picker'))) {
          return;
        }
        closeHeaderModelDropdown();
      },
      true,
    );

    chrome.storage.sync.get(['neuraModel'], (result) => {
      updateHeaderModelLabel(result.neuraModel || 'NEURA-IANUSTEC');
    });
  }

  async function populateHeaderModelSelect() {
    const select = Neura.shadow.$('header-model-select');
    if (!select) return;

    const stored = await new Promise((resolve) => {
      chrome.storage.sync.get(['neuraModel'], (r) => resolve(r.neuraModel || 'NEURA-IANUSTEC'));
    });

    try {
      const response = await sendRuntimeMessage({ action: 'getAvailableModels' });
      if (response.error) {
        fillModelSelectFallback(
          select,
          stored,
          response.error || Neura.i18n.t('loginToLoadModels'),
        );
        return;
      }

      const list =
        Neura.modelsList && typeof Neura.modelsList.modelsFromPayload === 'function'
          ? Neura.modelsList.modelsFromPayload(response.data, stored)
          : [];
      select.innerHTML = '';
      const idSet = new Set();

      for (const m of list) {
        const id = m.id;
        idSet.add(id);
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = m.name || id;
        if (id === stored) opt.selected = true;
        select.appendChild(opt);
      }

      if (!idSet.has(stored)) {
        const extra = document.createElement('option');
        extra.value = stored;
        extra.textContent = stored;
        if (select.options.length === 0) extra.selected = true;
        select.insertBefore(extra, select.firstChild);
        list.unshift({ id: stored, name: stored });
      }

      if (select.options.length === 0) {
        fillModelSelectFallback(select, stored, null);
        return;
      }

      select.value = stored;
      renderHeaderModelList(list, stored);
      updateHeaderModelLabel(stored);
    } catch (e) {
      console.warn('Neura: could not populate model select', e);
      fillModelSelectFallback(select, stored, Neura.i18n.t('loginToLoadModels'));
    }
  }

  Neura.ui.createMessagesWindow = function createMessagesWindow() {
    const mediaQueryMobileWith = window.matchMedia('(max-width: 768px)');
    const mediaQueryMobileHeight = window.matchMedia('(max-height: 430px)');
    const isMobile = mediaQueryMobileWith.matches || mediaQueryMobileHeight.matches;

    const backdrop = document.createElement('div');
    backdrop.id = 'chat-backdrop';

    const chatWindow = document.createElement('div');
    chatWindow.id = 'chat-window';
    chatWindow.dataset.theme = 'light';
    if (isMobile) chatWindow.classList.add('mobile');
    else chatWindow.classList.add('desktop');

    const chatShell = document.createElement('div');
    chatShell.id = 'chat-shell';

    const chatMain = document.createElement('div');
    chatMain.id = 'chat-main';

    const chatHeader = document.createElement('div');
    chatHeader.id = 'header-wrapper';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'chat-header-left';

    const modelPicker = document.createElement('div');
    modelPicker.id = 'header-model-picker';
    modelPicker.className = 'header-model-picker';

    const modelTrigger = document.createElement('button');
    modelTrigger.type = 'button';
    modelTrigger.id = 'header-model-trigger';
    modelTrigger.className = 'header-model-trigger';
    modelTrigger.title = Neura.i18n.t('modelLabel');
    modelTrigger.setAttribute('aria-haspopup', 'listbox');
    modelTrigger.setAttribute('aria-expanded', 'false');
    modelTrigger.innerHTML =
      `<span id="header-model-label" class="header-model-label">${Neura.i18n.t('loadModels')}</span>` +
      `<svg class="header-model-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="m6 9 6 6 6-6"/>` +
      `</svg>`;

    const modelSelect = document.createElement('select');
    modelSelect.id = 'header-model-select';
    modelSelect.className = 'header-model-select';
    modelSelect.hidden = true;
    modelSelect.setAttribute('aria-hidden', 'true');
    modelSelect.tabIndex = -1;
    modelSelect.innerHTML = `<option value="">${Neura.i18n.t('loadModels')}</option>`;

    const modelDropdown = document.createElement('div');
    modelDropdown.id = 'header-model-dropdown';
    modelDropdown.className = 'header-model-dropdown';
    modelDropdown.hidden = true;
    modelDropdown.setAttribute('role', 'listbox');

    const modelList = document.createElement('div');
    modelList.id = 'header-model-list';
    modelList.className = 'header-model-list';
    modelDropdown.appendChild(modelList);

    modelPicker.appendChild(modelTrigger);
    modelPicker.appendChild(modelSelect);
    modelPicker.appendChild(modelDropdown);
    headerLeft.appendChild(modelPicker);

    const headerRight = document.createElement('div');
    headerRight.className = 'chat-header-right';

    const MOON_ICON = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>`;
    const SUN_ICON = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4.5"/>
        <path d="M12 2.5v3M12 18.5v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2.5 12h3M18.5 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
      </svg>`;

    const themeToggleBtn = document.createElement('button');
    themeToggleBtn.id = 'theme-toggle-btn';
    themeToggleBtn.className = 'header-icon-btn';
    themeToggleBtn.type = 'button';

    function renderThemeToggleBtn(resolved) {
      const isDark = resolved === 'dark';
      themeToggleBtn.innerHTML = isDark ? SUN_ICON : MOON_ICON;
      themeToggleBtn.title = isDark
        ? Neura.i18n.t('themeToggleToLight')
        : Neura.i18n.t('themeToggleToDark');
    }

    renderThemeToggleBtn(Neura.theme ? Neura.theme.getResolved() : 'light');
    themeToggleBtn.addEventListener('click', () => {
      if (!Neura.theme) return;
      const next = Neura.theme.toggle();
      renderThemeToggleBtn(next);
    });
    if (Neura.theme) Neura.theme.onChange(renderThemeToggleBtn);

    const closeButton = document.createElement('button');
    closeButton.id = 'close-chat-btn';
    closeButton.className = 'header-icon-btn';
    closeButton.type = 'button';
    closeButton.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>`;
    closeButton.title = Neura.i18n.t('closeSidebarTitle');
    closeButton.addEventListener('click', () => Neura.chat.toggleChatWindowEventHandler());

    headerRight.appendChild(themeToggleBtn);
    headerRight.appendChild(closeButton);

    chatHeader.appendChild(headerLeft);
    chatHeader.appendChild(headerRight);

    const messageArea = document.createElement('div');
    messageArea.id = 'message-area';
    messageArea.addEventListener('scroll', () => {
      const distanceFromBottom = messageArea.scrollHeight - messageArea.scrollTop - messageArea.clientHeight;
      Neura.state.autoScrollEnabled = distanceFromBottom <= Neura.constants.SCROLL_BOTTOM_THRESHOLD;
      Neura.state.lastMessageAreaScrollAt = Date.now();
      Neura.state.suppressFocusUntil = Math.max(Neura.state.suppressFocusUntil, Date.now() + 1500);
    });
    ['mousedown', 'mousemove', 'mouseup', 'wheel'].forEach((evt) => {
      messageArea.addEventListener(
        evt,
        () => {
          Neura.state.lastMessageAreaInteractionAt = Date.now();
          if (evt === 'mousedown' || evt === 'wheel' || evt === 'mousemove') {
            Neura.state.suppressFocusUntil = Math.max(Neura.state.suppressFocusUntil, Date.now() + 1500);
          }
        },
        true,
      );
    });

    const inputWrapper = document.createElement('div');
    inputWrapper.id = 'input-wrapper';

    const composerBox = document.createElement('div');
    composerBox.id = 'composer-box';

    const knowledgeAttachmentsBar = document.createElement('div');
    knowledgeAttachmentsBar.id = 'knowledge-attachments-bar';
    knowledgeAttachmentsBar.className = 'knowledge-attachments-bar';
    knowledgeAttachmentsBar.style.display = 'none';
    composerBox.appendChild(knowledgeAttachmentsBar);

    const messageInput = document.createElement('textarea');
    messageInput.id = 'message-input';
    messageInput.placeholder = Neura.i18n.t('messagePlaceholder');
    messageInput.addEventListener('input', Neura.input.autoResizeTextarea);
    // Image URL paste is handled in keyboard-isolation.js (paste listeners on
    // shadow-DOM elements never run due to stopImmediatePropagation there).

    const composerFooter = document.createElement('div');
    composerFooter.id = 'composer-footer';

    const composerToolbar = document.createElement('div');
    composerToolbar.id = 'composer-toolbar';
    composerToolbar.className = 'composer-toolbar';

    const inputMenu = document.createElement('div');
    inputMenu.className = 'composer-menu';

    const inputMenuBtn = document.createElement('button');
    inputMenuBtn.id = 'input-menu-btn';
    inputMenuBtn.className = 'composer-icon-btn composer-menu-trigger';
    inputMenuBtn.type = 'button';
    inputMenuBtn.title = Neura.i18n.t('inputMenuTitle');
    inputMenuBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14"/>
      </svg>`;

    const inputMenuDropdown = document.createElement('div');
    inputMenuDropdown.id = 'input-menu-dropdown';
    inputMenuDropdown.className = 'composer-menu-dropdown';

    const integrationsMenu = document.createElement('div');
    integrationsMenu.className = 'composer-menu';

    const integrationsMenuBtn = document.createElement('button');
    integrationsMenuBtn.id = 'integrations-menu-btn';
    integrationsMenuBtn.className = 'composer-icon-btn composer-menu-trigger';
    integrationsMenuBtn.type = 'button';
    integrationsMenuBtn.title = Neura.i18n.t('integrationsMenuTitle');
    integrationsMenuBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>`;

    const integrationsMenuDropdown = document.createElement('div');
    integrationsMenuDropdown.id = 'integrations-menu-dropdown';
    integrationsMenuDropdown.className = 'composer-menu-dropdown integrations-menu-dropdown';

    const integrationsMenuItems = document.createElement('div');
    integrationsMenuItems.id = 'integrations-menu-items';
    integrationsMenuItems.className = 'integrations-menu-items';

    const composerSeparator = document.createElement('div');
    composerSeparator.className = 'composer-toolbar-separator';
    composerSeparator.setAttribute('aria-hidden', 'true');

    const CONTEXT_TOGGLE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <path d="M3 12h18"/>
        <path d="M12 3a14 14 0 0 1 3.5 9A14 14 0 0 1 12 21 14 14 0 0 1 8.5 12 14 14 0 0 1 12 3z"/>
      </svg>`;
    const SCREENSHOT_TOGGLE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>`;

    const contextToggleBtn = document.createElement('button');
    contextToggleBtn.id = 'context-toggle-btn';
    contextToggleBtn.className = 'toggle-btn integrations-menu-toggle';
    contextToggleBtn.innerHTML = buildComposerMenuItemContent(
      CONTEXT_TOGGLE_ICON,
      Neura.i18n.t('attachPageContextLabel'),
      Neura.i18n.t('attachPageContextHint'),
    );
    contextToggleBtn.title = Neura.i18n.t('atgeContextLabel');
    contextToggleBtn.dataset.active = 'true';
    contextToggleBtn.classList.add('active');
    chrome.storage.sync.get(['neuraAttachPageContext'], (data) => {
      const on = data.neuraAttachPageContext !== false;
      contextToggleBtn.dataset.active = on ? 'true' : 'false';
      contextToggleBtn.classList.toggle('active', on);
      refreshComposerChips();
    });
    contextToggleBtn.addEventListener('click', () => {
      const isActive = contextToggleBtn.dataset.active === 'true';
      const next = !isActive;
      contextToggleBtn.dataset.active = next.toString();
      contextToggleBtn.classList.toggle('active', next);
      chrome.storage.sync.set({ neuraAttachPageContext: next });
      refreshComposerChips();
    });

    const screenshotToggleBtn = document.createElement('button');
    screenshotToggleBtn.id = 'screenshot-toggle-btn';
    screenshotToggleBtn.className = 'toggle-btn integrations-menu-toggle';
    screenshotToggleBtn.innerHTML = buildComposerMenuItemContent(
      SCREENSHOT_TOGGLE_ICON,
      Neura.i18n.t('toggleScreenshot'),
      Neura.i18n.t('screenshotTitle'),
    );
    screenshotToggleBtn.title = Neura.i18n.t('screenshotTitle');
    screenshotToggleBtn.dataset.active = 'false';
    chrome.storage.sync.get(['neuraVisionScreenshots'], (data) => {
      const on = data.neuraVisionScreenshots === true;
      screenshotToggleBtn.dataset.active = on ? 'true' : 'false';
      screenshotToggleBtn.classList.toggle('active', on);
      refreshComposerChips();
    });
    screenshotToggleBtn.addEventListener('click', () => {
      const next = screenshotToggleBtn.dataset.active !== 'true';
      screenshotToggleBtn.dataset.active = next.toString();
      screenshotToggleBtn.classList.toggle('active', next);
      chrome.storage.sync.set({ neuraVisionScreenshots: next });
      refreshComposerChips();
    });

    const knowledgeToggleBtn = document.createElement('button');
    knowledgeToggleBtn.id = 'knowledge-toggle-btn';
    knowledgeToggleBtn.className = 'toggle-btn';
    knowledgeToggleBtn.innerHTML = buildComposerMenuItemContent(
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <path d="M8 7h8M8 11h8M8 15h6"/>
      </svg>`,
      Neura.i18n.t('toggleKnowledge'),
      Neura.i18n.t('knowledgeTitle'),
    );
    knowledgeToggleBtn.title = Neura.i18n.t('knowledgeTitle');
    knowledgeToggleBtn.dataset.active = 'false';
    knowledgeToggleBtn.addEventListener('click', () => {
      const isActive = knowledgeToggleBtn.dataset.active === 'true';
      knowledgeToggleBtn.dataset.active = (!isActive).toString();
      knowledgeToggleBtn.classList.toggle('active', !isActive);
    });
    integrationsMenuItems.appendChild(wrapIntegrationsMenuRow(knowledgeToggleBtn));

    const AGENT_TOGGLE_ICON =
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/>` +
      `</svg>`;

    // Static "N" monogram (Neura brand gradient) used for the dropdown
    // trigger. It never changes appearance based on which toggles inside
    // are active — the dropdown itself is the only feedback surface.
    const NEURA_N_ICON =
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="url(#neura-icon-gradient)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="M6 5v14"/><path d="M6 5l12 14"/><path d="M18 5v14"/>` +
      `</svg>`;

    // Trigger button + dropdown that groups Agent mode with the "context"
    // toggles (screenshot, attach page). Lives where the standalone Agent
    // icon used to sit in the toolbar. The trigger icon/state never reflects
    // which toggles are active inside it (by design).
    const agentMenu = document.createElement('div');
    agentMenu.className = 'composer-menu agent-menu';

    const agentMenuBtn = document.createElement('button');
    agentMenuBtn.id = 'agent-menu-btn';
    agentMenuBtn.className = 'composer-icon-btn composer-menu-trigger agent-menu-trigger';
    agentMenuBtn.type = 'button';
    agentMenuBtn.title = Neura.i18n.t('agentMenuTitle');
    agentMenuBtn.innerHTML = NEURA_N_ICON;

    const agentMenuDropdown = document.createElement('div');
    agentMenuDropdown.id = 'agent-menu-dropdown';
    agentMenuDropdown.className = 'composer-menu-dropdown integrations-menu-dropdown agent-menu-dropdown';

    const agentMenuItems = document.createElement('div');
    agentMenuItems.id = 'agent-menu-items';
    agentMenuItems.className = 'integrations-menu-items agent-menu-items';
    agentMenuDropdown.appendChild(agentMenuItems);

    agentMenu.appendChild(agentMenuBtn);
    agentMenu.appendChild(agentMenuDropdown);

    const agentToggleBtn = document.createElement('button');
    agentToggleBtn.id = 'agent-toggle-btn';
    agentToggleBtn.className = 'toggle-btn integrations-menu-toggle';
    agentToggleBtn.innerHTML = buildComposerMenuItemContent(
      AGENT_TOGGLE_ICON,
      Neura.i18n.t('toggleAgent'),
      Neura.i18n.t('agentTitle'),
    );
    agentToggleBtn.title = Neura.i18n.t('agentTitle');
    agentToggleBtn.dataset.active = 'false';

    agentToggleBtn.addEventListener('click', () => {
      const isActive = agentToggleBtn.dataset.active === 'true';
      const next = !isActive;
      agentToggleBtn.dataset.active = next.toString();
      agentToggleBtn.classList.toggle('active', next);
      Neura.state.agentMode = next;
      if (!next) {
        if (Neura.state.agentRunning && Neura.streaming?.abortActiveStream) {
          Neura.streaming.abortActiveStream();
        } else if (Neura.agentLog) {
          Neura.agentLog.endSession();
        }
      }
      refreshComposerChips();
    });
    agentMenuItems.appendChild(wrapIntegrationsMenuRow(agentToggleBtn));
    agentMenuItems.appendChild(wrapIntegrationsMenuRow(screenshotToggleBtn));
    agentMenuItems.appendChild(wrapIntegrationsMenuRow(contextToggleBtn));

    const webSearchToggleBtn = document.createElement('button');
    webSearchToggleBtn.id = 'web-search-toggle-btn';
    webSearchToggleBtn.className = 'toggle-btn feature-toggle-btn integrations-menu-toggle';
    webSearchToggleBtn.innerHTML = buildComposerMenuItemContent(
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.3-4.3"/>
      </svg>`,
      Neura.i18n.t('toggleWebSearch'),
      Neura.i18n.t('webSearchTitle'),
    );
    webSearchToggleBtn.title = Neura.i18n.t('webSearchTitle');
    webSearchToggleBtn.dataset.active = 'false';
    webSearchToggleBtn.addEventListener('click', () => {
      const isActive = webSearchToggleBtn.dataset.active === 'true';
      const next = !isActive;
      webSearchToggleBtn.dataset.active = next.toString();
      webSearchToggleBtn.classList.toggle('active', next);
      Neura.state.featureToggles.web_search = next;
    });
    const webSearchRow = wrapIntegrationsMenuRow(webSearchToggleBtn);
    webSearchRow.hidden = true;
    integrationsMenuItems.appendChild(webSearchRow);

    const codeInterpreterToggleBtn = document.createElement('button');
    codeInterpreterToggleBtn.id = 'code-interpreter-toggle-btn';
    codeInterpreterToggleBtn.className = 'toggle-btn feature-toggle-btn integrations-menu-toggle';
    codeInterpreterToggleBtn.innerHTML = buildComposerMenuItemContent(
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>`,
      Neura.i18n.t('toggleCodeInterpreter'),
      Neura.i18n.t('codeInterpreterTitle'),
    );
    codeInterpreterToggleBtn.title = Neura.i18n.t('codeInterpreterTitle');
    codeInterpreterToggleBtn.dataset.active = 'false';
    codeInterpreterToggleBtn.addEventListener('click', () => {
      const isActive = codeInterpreterToggleBtn.dataset.active === 'true';
      const next = !isActive;
      codeInterpreterToggleBtn.dataset.active = next.toString();
      codeInterpreterToggleBtn.classList.toggle('active', next);
      Neura.state.featureToggles.code_interpreter = next;
    });
    const codeInterpreterRow = wrapIntegrationsMenuRow(codeInterpreterToggleBtn);
    codeInterpreterRow.hidden = true;
    integrationsMenuItems.appendChild(codeInterpreterRow);

    const imageGenToggleBtn = document.createElement('button');
    imageGenToggleBtn.id = 'image-gen-toggle-btn';
    imageGenToggleBtn.className = 'toggle-btn feature-toggle-btn integrations-menu-toggle';
    imageGenToggleBtn.innerHTML = buildComposerMenuItemContent(
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="m21 15-5-5L5 21"/>
      </svg>`,
      Neura.i18n.t('toggleImageGen'),
      Neura.i18n.t('imageGenTitle'),
    );
    imageGenToggleBtn.title = Neura.i18n.t('imageGenTitle');
    imageGenToggleBtn.dataset.active = 'false';
    imageGenToggleBtn.addEventListener('click', () => {
      const isActive = imageGenToggleBtn.dataset.active === 'true';
      const next = !isActive;
      imageGenToggleBtn.dataset.active = next.toString();
      imageGenToggleBtn.classList.toggle('active', next);
      Neura.state.featureToggles.image_generation = next;
    });
    const imageGenRow = wrapIntegrationsMenuRow(imageGenToggleBtn);
    imageGenRow.hidden = true;
    integrationsMenuItems.appendChild(imageGenRow);

    // Keep the integrations menu entries in alphabetical order (by their
    // visible label) regardless of the order they were created/appended in.
    sortMenuRowsAlphabetically(integrationsMenuItems, '.integrations-menu-row');

    const toolPickerMenu = document.createElement('div');
    toolPickerMenu.id = 'tool-picker-wrapper';
    toolPickerMenu.className = 'composer-menu tool-picker-menu';
    toolPickerMenu.hidden = true;

    const toolPickerBtn = document.createElement('button');
    toolPickerBtn.id = 'tool-picker-btn';
    toolPickerBtn.className = 'composer-icon-btn composer-menu-trigger tool-picker-toolbar-btn';
    toolPickerBtn.type = 'button';
    toolPickerBtn.title = Neura.i18n.t('toolPickerTitle');
    toolPickerBtn.innerHTML =
      `<span class="tool-picker-icon-wrap" aria-hidden="true">` +
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>` +
      `</svg>` +
      `</span>`;
    toolPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const overlay = Neura.shadow.$('tool-picker-overlay');
      if (overlay?.classList.contains('open')) {
        closeToolPicker();
        return;
      }
      openToolPicker();
    });
    toolPickerMenu.appendChild(toolPickerBtn);

    const activeToolsMenu = document.createElement('div');
    activeToolsMenu.id = 'active-tools-wrapper';
    activeToolsMenu.className = 'composer-menu active-tools-menu';
    activeToolsMenu.hidden = true;

    const activeToolsBtn = document.createElement('button');
    activeToolsBtn.id = 'active-tools-btn';
    activeToolsBtn.className = 'composer-icon-btn composer-menu-trigger active-tools-toolbar-btn';
    activeToolsBtn.type = 'button';
    activeToolsBtn.title = Neura.i18n.t('activeToolsTitle');
    activeToolsBtn.innerHTML =
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<polygon points="12 2 2 7 12 12 22 7 12 2"/>` +
      `<polyline points="2 17 12 22 22 17"/>` +
      `<polyline points="2 12 12 17 22 12"/>` +
      `</svg>` +
      `<span id="active-tools-count" class="active-tools-count" hidden></span>`;
    activeToolsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeHeaderModelDropdown();
      const dropdown = Neura.shadow.$('active-tools-dropdown');
      const willOpen = !dropdown?.classList.contains('open');
      Neura.ui.closeComposerMenus?.();
      closeToolPicker();
      closeActiveToolsDropdown();
      if (willOpen) {
        renderActiveToolsDropdown();
        dropdown?.classList.add('open');
        requestAnimationFrame(() => {
          document.addEventListener('click', handleActiveToolsOutsideClick, true);
        });
      }
    });

    const activeToolsDropdown = document.createElement('div');
    activeToolsDropdown.id = 'active-tools-dropdown';
    activeToolsDropdown.className = 'composer-menu-dropdown active-tools-dropdown';

    const activeToolsList = document.createElement('div');
    activeToolsList.id = 'active-tools-list';
    activeToolsList.className = 'active-tools-list';
    activeToolsDropdown.appendChild(activeToolsList);

    activeToolsMenu.appendChild(activeToolsBtn);
    activeToolsMenu.appendChild(activeToolsDropdown);

    const fileAttachInput = document.createElement('input');
    fileAttachInput.type = 'file';
    fileAttachInput.id = 'file-attach-input';
    fileAttachInput.multiple = true;
    fileAttachInput.hidden = true;
    fileAttachInput.addEventListener('change', async () => {
      Neura.ui.closeComposerMenus?.();
      const files = Array.from(fileAttachInput.files || []);
      fileAttachInput.value = '';
      for (const file of files) {
        try {
          await Neura.fileAttachments.uploadLocalFile(file);
        } catch (e) {
          console.warn('[Neura] file upload failed', e);
        }
      }
    });
    // Also close the "+" menu when the native file dialog is dismissed without
    // picking anything. The 'cancel' event covers modern browsers; the
    // one-time window 'focus' listener is a fallback for browsers where the
    // OS file picker doesn't fire it (focus returns to the page as soon as
    // the native dialog closes, whether a file was chosen or not).
    fileAttachInput.addEventListener('cancel', () => {
      Neura.ui.closeComposerMenus?.();
    });

    const fileAttachBtn = document.createElement('button');
    fileAttachBtn.id = 'file-attach-btn';
    fileAttachBtn.className = 'composer-menu-item attach-action-btn';
    fileAttachBtn.type = 'button';
    fileAttachBtn.innerHTML = buildComposerMenuItemContent(
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
      </svg>`,
      Neura.i18n.t('attachFile'),
      Neura.i18n.t('attachFileTitle'),
    );
    fileAttachBtn.title = Neura.i18n.t('attachFileTitle');
    fileAttachBtn.addEventListener('click', () => {
      fileAttachInput.click();
      const onWindowFocusBack = () => {
        window.removeEventListener('focus', onWindowFocusBack);
        // Give 'change'/'cancel' a chance to fire first; only force-close
        // the menu if it is still open (i.e. neither event fired).
        setTimeout(() => Neura.ui.closeComposerMenus?.(), 250);
      };
      window.addEventListener('focus', onWindowFocusBack, { once: true });
    });

    inputMenuDropdown.appendChild(fileAttachBtn);
    inputMenu.appendChild(inputMenuBtn);
    inputMenu.appendChild(inputMenuDropdown);
    inputMenu.appendChild(fileAttachInput);

    integrationsMenuDropdown.appendChild(integrationsMenuItems);
    integrationsMenu.appendChild(integrationsMenuBtn);
    integrationsMenu.appendChild(integrationsMenuDropdown);

    // Shown only while Agent mode is on, to the left of its dropdown, so the
    // user always sees it's active without opening the menu. Same
    // static-until-hover / "X" behavior as the screenshot & context
    // indicators (see refreshComposerChips below).
    const agentActiveIndicatorWrap = document.createElement('div');
    agentActiveIndicatorWrap.id = 'agent-active-indicator-wrap';
    agentActiveIndicatorWrap.className = 'composer-context-indicators agent-active-indicator-wrap';
    agentActiveIndicatorWrap.hidden = true;

    composerToolbar.appendChild(agentActiveIndicatorWrap);
    composerToolbar.appendChild(agentMenu);
    composerToolbar.appendChild(composerSeparator);
    composerToolbar.appendChild(inputMenu);
    composerToolbar.appendChild(integrationsMenu);
    composerToolbar.appendChild(toolPickerMenu);
    composerToolbar.appendChild(activeToolsMenu);

    const toolPickerOverlay = document.createElement('div');
    toolPickerOverlay.id = 'tool-picker-overlay';
    toolPickerOverlay.className = 'tool-picker-overlay';
    toolPickerOverlay.setAttribute('aria-hidden', 'true');
    toolPickerOverlay.innerHTML = `
      <div class="tool-picker-panel" role="dialog" aria-labelledby="tool-picker-heading">
        <div class="tool-picker-header">
          <h4 id="tool-picker-heading" class="tool-picker-heading">${Neura.i18n.t('toolPickerTitle')}</h4>
          <button type="button" class="tool-picker-close-btn" data-tool-picker-close aria-label="${Neura.i18n.t('closeSidebarTitle')}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div id="tool-picker-list" class="tool-picker-list"></div>
      </div>`;
    const toolPickerPanel = toolPickerOverlay.querySelector('.tool-picker-panel');
    toolPickerPanel?.addEventListener('mousedown', (e) => e.stopPropagation());
    toolPickerPanel?.addEventListener('click', (e) => e.stopPropagation());

    toolPickerOverlay.querySelectorAll('[data-tool-picker-close]').forEach((el) => {
      el.addEventListener('click', closeToolPicker);
    });
    toolPickerOverlay.addEventListener('click', (e) => {
      if (e.target === toolPickerOverlay) closeToolPicker();
    });

    // Icon-only indicators shown in the toolbar (next to the active-tools
    // button) for the toggles selected from the agent dropdown (screenshot,
    // attach page). No text label — just the icon. Static until hover/tap,
    // then widen slightly to reveal a close ("X") control that turns the
    // toggle off; re-enabling requires reopening the dropdown.
    const composerContextIndicators = document.createElement('div');
    composerContextIndicators.id = 'composer-context-indicators';
    composerContextIndicators.className = 'composer-context-indicators';
    composerContextIndicators.hidden = true;
    composerToolbar.appendChild(composerContextIndicators);

    function createContextIndicator({ key, title, iconSvg, onRemove }) {
      const indicator = document.createElement('button');
      indicator.type = 'button';
      indicator.className = 'composer-icon-btn context-indicator-btn';
      indicator.dataset.indicatorKey = key;
      indicator.title = title;
      indicator.innerHTML =
        `<span class="context-indicator-icon" aria-hidden="true">${iconSvg}</span>` +
        `<span class="context-indicator-remove" role="button" tabindex="0" title="${Neura.i18n.t('disableChip')}" aria-label="${Neura.i18n.t('disableChip')}">` +
        `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>` +
        `</span>`;
      indicator.addEventListener('click', (e) => {
        if (e.target.closest('.context-indicator-remove')) {
          e.stopPropagation();
          onRemove();
          return;
        }
        // Touch devices have no hover: tapping reveals the "X".
        indicator.classList.toggle('expanded');
      });
      indicator.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.context-indicator-remove')) {
          e.preventDefault();
          onRemove();
        }
      });
      return indicator;
    }

    function refreshComposerChips() {
      composerContextIndicators.innerHTML = '';
      const definitions = [
        {
          key: 'screenshot',
          active: screenshotToggleBtn.dataset.active === 'true',
          title: Neura.i18n.t('toggleScreenshot'),
          icon: SCREENSHOT_TOGGLE_ICON,
          onRemove: () => screenshotToggleBtn.click(),
        },
        {
          key: 'context',
          active: contextToggleBtn.dataset.active === 'true',
          title: Neura.i18n.t('attachPageContextLabel'),
          icon: CONTEXT_TOGGLE_ICON,
          onRemove: () => contextToggleBtn.click(),
        },
      ];
      const activeDefs = definitions.filter((d) => d.active);
      activeDefs.forEach((d) => {
        composerContextIndicators.appendChild(
          createContextIndicator({ key: d.key, title: d.title, iconSvg: d.icon, onRemove: d.onRemove }),
        );
      });
      composerContextIndicators.hidden = activeDefs.length === 0;

      // Agent mode gets its own indicator, to the left of its dropdown
      // trigger rather than next to the active-tools button.
      agentActiveIndicatorWrap.innerHTML = '';
      const agentActive = agentToggleBtn.dataset.active === 'true';
      if (agentActive) {
        agentActiveIndicatorWrap.appendChild(
          createContextIndicator({
            key: 'agent',
            title: Neura.i18n.t('toggleAgent'),
            iconSvg: AGENT_TOGGLE_ICON,
            onRemove: () => agentToggleBtn.click(),
          }),
        );
      }
      agentActiveIndicatorWrap.hidden = !agentActive;
    }

    const sendButton = document.createElement('button');
    sendButton.id = 'send-button';
    sendButton.type = 'button';
    const sendIcon = document.createElement('div');
    sendIcon.id = 'send-icon';
    sendIcon.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
      </svg>`;
    sendButton.appendChild(sendIcon);
    sendButton.addEventListener('click', () => Neura.streaming.handleSendButtonClick(sendIcon));

    const composerActions = document.createElement('div');
    composerActions.id = 'composer-actions';
    composerActions.className = 'composer-actions';
    composerActions.appendChild(sendButton);
    if (Neura.voiceControls?.mountComposerButtons) {
      Neura.voiceControls.mountComposerButtons(composerActions);
    }

    composerFooter.appendChild(composerToolbar);
    composerFooter.appendChild(composerActions);

    composerBox.appendChild(messageInput);
    composerBox.appendChild(composerFooter);

    // Paint immediately with the synchronous default toggle states; the
    // chrome.storage.sync callbacks above will call this again once the
    // persisted values are known.
    refreshComposerChips();

    inputWrapper.appendChild(composerBox);

    chatMain.appendChild(chatHeader);
    chatMain.appendChild(messageArea);
    chatMain.appendChild(inputWrapper);

    chatShell.appendChild(chatMain);

    if (!isMobile) {
      const resizeHandle = document.createElement('div');
      resizeHandle.id = 'chat-resize-handle';
      resizeHandle.setAttribute('aria-label', 'Resize panel');
      resizeHandle.setAttribute('role', 'separator');
      resizeHandle.setAttribute('aria-orientation', 'vertical');
      chatWindow.appendChild(resizeHandle);
    }

    chatWindow.appendChild(chatShell);
    chatWindow.appendChild(toolPickerOverlay);

    Neura.messages.attachResizeObserver(chatWindow);

    chatWindow._backdrop = backdrop;
    backdrop.addEventListener('click', () => Neura.chat.toggleChatWindowEventHandler());

    // Shared gradient definition (Neura logo hues) referenced via
    // `stroke: url(#neura-icon-gradient)` from styles-owui.css so every
    // composer icon shares the same brand coloring.
    const iconGradientDefs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconGradientDefs.setAttribute('aria-hidden', 'true');
    iconGradientDefs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    iconGradientDefs.innerHTML =
      `<defs><linearGradient id="neura-icon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">` +
      `<stop offset="0%" stop-color="#22d3ee"/>` +
      `<stop offset="45%" stop-color="#6366f1"/>` +
      `<stop offset="75%" stop-color="#a855f7"/>` +
      `<stop offset="100%" stop-color="#ec4899"/>` +
      `</linearGradient></defs>`;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(iconGradientDefs);
    fragment.appendChild(backdrop);
    fragment.appendChild(chatWindow);

    // Deferred to next frame: at this point `fragment` has not yet been
    // appended to the shadow root by the caller, so any Neura.shadow.$()
    // lookup for elements created above (model select, toggles, sidebar)
    // would fail silently. By the next animation frame the caller has
    // already inserted the fragment into the DOM.
    requestAnimationFrame(() => {
      if (Neura.chatSidebar) Neura.chatSidebar.mount(chatShell);
      if (Neura.theme) Neura.theme.init();
      // Always start with chat history collapsed (mobile + desktop).
      if (Neura.chatSidebar) Neura.chatSidebar.hide();
      setupComposerDropdownMenus();
      setupHeaderModelPicker();
      setupFeatureToggleRefresh();
      populateHeaderModelSelect();
      if (Neura.modelMention) Neura.modelMention.init();
      if (Neura.knowledgeMention) Neura.knowledgeMention.init();
      if (Neura.promptMention) Neura.promptMention.init();
      if (Neura.voiceSession?.mount) Neura.voiceSession.mount();
      if (Neura.branding?.refresh) Neura.branding.refresh().catch(() => {});
    });

    return fragment;
  };

  Neura.ui.refreshHeaderModelSelect = populateHeaderModelSelect;
  Neura.ui.applyHeaderModel = applyHeaderModel;

  function applyFeatureToggleState(btn, featureKey, enabled, defaultOn) {
    if (!btn) return;
    const row = btn.closest('.integrations-menu-row');
    if (row) {
      row.hidden = !enabled;
    } else {
      btn.style.display = enabled ? '' : 'none';
    }
    if (!enabled) return;
    const active = !!defaultOn;
    btn.dataset.active = active.toString();
    btn.classList.toggle('active', active);
    if (Neura.state.featureToggles && featureKey in Neura.state.featureToggles) {
      Neura.state.featureToggles[featureKey] = active;
    }
  }

  function setupFeatureToggleRefresh() {
    chrome.storage.sync.get(['neuraModel'], (result) => {
      refreshFeatureToggles(result.neuraModel || 'NEURA-IANUSTEC');
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.neuraModel) {
        const next = changes.neuraModel.newValue || 'NEURA-IANUSTEC';
        refreshFeatureToggles(next);
        updateHeaderModelLabel(next);
      }
    });
  }

  function eventComposedNodes(e) {
    if (typeof e.composedPath === 'function') {
      return e.composedPath();
    }
    return e.target instanceof Node ? [e.target] : [];
  }

  function nodeInToolPickerUi(node) {
    if (!(node instanceof Element)) return false;
    return !!node.closest?.(
      '#tool-picker-overlay, #tool-picker-btn, #tool-picker-wrapper, #integrations-menu-btn, #integrations-menu-dropdown',
    );
  }

  function positionComposerPopover(overlayId, anchorId) {
    const overlay = Neura.shadow.$(overlayId);
    const panel = overlay?.querySelector('.tool-picker-panel');
    const chatWindow = Neura.shadow.$('chat-window');
    const anchor = Neura.shadow.$(anchorId);
    if (!overlay || !panel || !chatWindow || !anchor) return;

    const chatRect = chatWindow.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(360, chatRect.width - 24);
    panel.style.width = `${width}px`;

    let left = rect.left - chatRect.left;
    if (left + width > chatRect.width - 12) {
      left = chatRect.width - width - 12;
    }
    panel.style.left = `${Math.max(12, left)}px`;

    const gap = 10;
    const spaceAbove = Math.max(0, rect.top - chatRect.top);
    const spaceBelow = Math.max(0, chatRect.bottom - rect.bottom);
    const preferAbove = spaceAbove >= spaceBelow;
    const available = (preferAbove ? spaceAbove : spaceBelow) - gap;
    panel.style.maxHeight = `${Math.max(160, Math.min(420, available || 320))}px`;

    if (preferAbove) {
      panel.style.bottom = `${chatRect.bottom - rect.top + gap}px`;
      panel.style.top = 'auto';
    } else {
      panel.style.top = `${rect.bottom - chatRect.top + gap}px`;
      panel.style.bottom = 'auto';
    }
  }

  function positionToolPickerPopover() {
    positionComposerPopover('tool-picker-overlay', 'tool-picker-btn');
  }

  function openToolPicker() {
    const overlay = Neura.shadow.$('tool-picker-overlay');
    if (!overlay) return;
    Neura.ui.closeComposerMenus?.();
    closeActiveToolsDropdown();
    Neura.shadow.$('input-menu-dropdown')?.classList.remove('open');
    const chatWindow = Neura.shadow.$('chat-window');
    if (chatWindow?.dataset?.theme) {
      overlay.dataset.theme = chatWindow.dataset.theme;
    }
    chatWindow?.classList.add('tool-picker-open');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    positionToolPickerPopover();
    loadToolPickerList();
    requestAnimationFrame(() => {
      document.addEventListener('click', handleToolPickerOutsideClick, true);
    });
    window.addEventListener('resize', positionToolPickerPopover);
  }

  function handleToolPickerOutsideClick(e) {
    const overlay = Neura.shadow.$('tool-picker-overlay');
    if (!overlay?.classList.contains('open')) return;
    if (eventComposedNodes(e).some(nodeInToolPickerUi)) return;
    closeToolPicker();
  }

  function closeToolPicker() {
    const overlay = Neura.shadow.$('tool-picker-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    Neura.shadow.$('chat-window')?.classList.remove('tool-picker-open');
    document.removeEventListener('click', handleToolPickerOutsideClick, true);
    window.removeEventListener('resize', positionToolPickerPopover);
    updateToolPickerBadge((Neura.state.selectedToolIds || []).length);
  }

  function updateToolPickerBadge(count) {
    const btn = Neura.shadow.$('tool-picker-btn');
    const n = Math.max(0, Number(count) || 0);
    if (btn) {
      btn.classList.toggle('has-selection', n > 0);
      btn.title =
        n > 0 ? `${Neura.i18n.t('toolPickerTitle')} (${n})` : Neura.i18n.t('toolPickerTitle');
    }
    updateActiveToolsIndicator(n);
  }

  function updateActiveToolsIndicator(count) {
    const countEl = Neura.shadow.$('active-tools-count');
    const btn = Neura.shadow.$('active-tools-btn');
    if (!countEl || !btn) return;
    const n = Math.max(0, Number(count) || 0);
    if (n > 0) {
      countEl.textContent = String(n);
      countEl.hidden = false;
      btn.title = `${Neura.i18n.t('activeToolsTitle')} (${n})`;
    } else {
      countEl.textContent = '';
      countEl.hidden = true;
      btn.title = Neura.i18n.t('activeToolsTitle');
    }
    const dropdown = Neura.shadow.$('active-tools-dropdown');
    if (dropdown?.classList.contains('open')) renderActiveToolsDropdown();
  }

  function renderActiveToolsDropdown() {
    const listEl = Neura.shadow.$('active-tools-list');
    if (!listEl) return;
    const meta = (Neura.state.selectedToolsMeta || [])
      .slice()
      .sort((a, b) =>
        String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''), undefined, {
          sensitivity: 'base',
        }),
      );
    listEl.innerHTML = '';
    if (meta.length === 0) {
      listEl.innerHTML = `<div class="active-tools-empty">${Neura.i18n.t('noActiveTools')}</div>`;
      return;
    }
    for (const tool of meta) {
      const item = document.createElement('div');
      item.className = 'active-tools-item';
      const dot = document.createElement('span');
      dot.className = 'active-tools-item-dot';
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'active-tools-item-name';
      name.textContent = tool.name || tool.id;
      item.appendChild(dot);
      item.appendChild(name);
      listEl.appendChild(item);
    }
  }

  function closeActiveToolsDropdown() {
    Neura.shadow.$('active-tools-dropdown')?.classList.remove('open');
    document.removeEventListener('click', handleActiveToolsOutsideClick, true);
  }

  function handleActiveToolsOutsideClick(e) {
    const dropdown = Neura.shadow.$('active-tools-dropdown');
    if (!dropdown?.classList.contains('open')) return;
    const inside = eventComposedNodes(e).some(
      (node) => node instanceof Element && node.closest?.('#active-tools-wrapper'),
    );
    if (inside) return;
    closeActiveToolsDropdown();
  }

  function truncateToolDescription(text, maxLen = 140) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw || raw.length <= maxLen) return raw;
    return `${raw.slice(0, maxLen - 1).trim()}…`;
  }

  async function refreshFeatureToggles(modelId) {
    const webBtn = Neura.shadow.$('web-search-toggle-btn');
    const codeBtn = Neura.shadow.$('code-interpreter-toggle-btn');
    const imageBtn = Neura.shadow.$('image-gen-toggle-btn');
    const pickerWrapper = Neura.shadow.$('tool-picker-wrapper');
    const activeToolsWrapper = Neura.shadow.$('active-tools-wrapper');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'owui:getAvailableFeatures',
        modelId,
      });
      if (!response || response.error) return;

      const { available = {}, defaults = {} } = response;
      applyFeatureToggleState(webBtn, 'web_search', available.web_search, defaults.web_search);
      applyFeatureToggleState(
        codeBtn,
        'code_interpreter',
        available.code_interpreter,
        defaults.code_interpreter,
      );
      applyFeatureToggleState(
        imageBtn,
        'image_generation',
        available.image_generation,
        defaults.image_generation,
      );

      if (pickerWrapper) {
        pickerWrapper.hidden = false;
      }
      if (activeToolsWrapper) {
        activeToolsWrapper.hidden = false;
      }

      await loadToolPickerList(modelId);
    } catch (e) {
      console.warn('Neura: could not refresh feature toggles', e);
    }
  }

  async function loadToolPickerList(modelId) {
    const listEl = Neura.shadow.$('tool-picker-list');
    if (!listEl) return;

    const resolvedModelId =
      modelId ||
      (await new Promise((resolve) => {
        chrome.storage.sync.get(['neuraModel'], (r) => resolve(r.neuraModel || 'NEURA-IANUSTEC'));
      }));

    listEl.innerHTML = `<div class="tool-picker-empty">${Neura.i18n.t('loading')}</div>`;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'owui:getToolsList',
        modelId: resolvedModelId,
      });
      const tools = response?.tools || [];
      const selected = new Set(response?.selected || []);
      Neura.state.selectedToolIds = [...selected];
      Neura.state.selectedToolsMeta = tools
        .filter((t) => selected.has(t?.id))
        .map((t) => ({ id: t.id, name: t.name || t.id }));
      updateToolPickerBadge(selected.size);

      listEl.innerHTML = '';
      if (tools.length === 0) {
        listEl.innerHTML = `<div class="tool-picker-empty">${Neura.i18n.t('toolPickerEmpty')}</div>`;
        return;
      }

      const sortedTools = tools.slice().sort((a, b) =>
        String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''), undefined, {
          sensitivity: 'base',
        }),
      );

      for (const tool of sortedTools) {
        const id = tool?.id;
        if (!id) continue;

        const fullDesc = tool.meta?.description || tool.description || '';
        const shortDesc = truncateToolDescription(fullDesc);

        const item = document.createElement('label');
        item.className = 'tool-picker-item';

        const row = document.createElement('div');
        row.className = 'tool-picker-item-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = id;
        checkbox.checked = selected.has(id);

        const textWrap = document.createElement('div');
        textWrap.className = 'tool-picker-item-text';

        const name = document.createElement('span');
        name.className = 'tool-picker-item-name';
        // Keep server tool name as-is; only descriptions follow UI locale.
        name.textContent = tool.name || id;
        if (fullDesc) name.title = fullDesc;

        textWrap.appendChild(name);

        let descEl = null;
        if (shortDesc) {
          descEl = document.createElement('span');
          descEl.className = 'tool-picker-item-desc';
          descEl.textContent = shortDesc;
          if (fullDesc && fullDesc !== shortDesc) descEl.title = fullDesc;
          textWrap.appendChild(descEl);
        }

        row.appendChild(checkbox);
        row.appendChild(textWrap);
        item.appendChild(row);

        checkbox.addEventListener('change', async () => {
          const checked = listEl.querySelectorAll('input[type="checkbox"]:checked');
          const toolIds = [...checked].map((el) => el.value);
          Neura.state.selectedToolIds = toolIds;
          Neura.state.selectedToolsMeta = tools
            .filter((t) => toolIds.includes(t?.id))
            .map((t) => ({ id: t.id, name: t.name || t.id }));
          updateToolPickerBadge(toolIds.length);
          try {
            await chrome.runtime.sendMessage({
              action: 'owui:setSelectedTools',
              modelId: resolvedModelId,
              toolIds,
            });
          } catch (e) {
            console.warn('Neura: could not persist tool selection', e);
          }
        });

        listEl.appendChild(item);

        if (fullDesc && descEl && Neura.i18n && typeof Neura.i18n.translateToUiLocale === 'function') {
          Neura.i18n
            .translateToUiLocale(fullDesc)
            .then((localized) => {
              if (!localized || !descEl.isConnected) return;
              const short = truncateToolDescription(localized);
              descEl.textContent = short;
              name.title = localized;
              descEl.title = localized !== short ? localized : '';
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      listEl.innerHTML = `<div class="tool-picker-empty">${Neura.i18n.t('toolPickerEmpty')}</div>`;
    }
  }

  Neura.ui.refreshFeatureToggles = refreshFeatureToggles;
  Neura.ui.loadToolPickerList = loadToolPickerList;
  Neura.ui.openToolPicker = openToolPicker;
  Neura.ui.closeToolPicker = closeToolPicker;
})(window.Neura);
