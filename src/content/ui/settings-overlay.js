(function (Neura) {
  // Placeholder default when no server is configured in extension settings.
  const DEFAULT_API_ENDPOINT = 'https://your-openwebui-server.example/api/chat/completions';
  const API_SUFFIX = '/api/chat/completions';

  function normalizeApiEndpoint(raw) {
    let url = String(raw || '').trim();
    if (!url) return DEFAULT_API_ENDPOINT;

    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    url = url
      .replace(/\/api\/chatm\/completition/gi, API_SUFFIX)
      .replace(/\/api\/chat\/completition/gi, API_SUFFIX)
      .replace(/\/api\/chatm\/completions/gi, API_SUFFIX)
      .replace(/\/api\/chat\/completion(?=\/?($|[?#]))/gi, API_SUFFIX);

    url = url.replace(/\/+$/, '');

    if (!new RegExp(`${API_SUFFIX.replace(/\//g, '\\/')}$`, 'i').test(url)) {
      url = `${url}${API_SUFFIX}`;
    }

    return url;
  }

  function sendSettingsAction(action, extra = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action, ...extra }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  function extractLeadingEmoji(title) {
    const raw = String(title || '').trim();
    if (!raw) return { emoji: '💬', text: raw };
    const match = raw.match(
      /^(\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*)\s*/u,
    );
    if (match) {
      return { emoji: match[1], text: raw.slice(match[0].length).trim() || raw };
    }
    return { emoji: '💬', text: raw };
  }

  Neura.settings = {
    showSettingsOverlay() {
      const shadowRoot = Neura.shadow.root();
      if (!shadowRoot) return;
      const chatWindow = shadowRoot.getElementById('chat-window');
      if (!chatWindow) return;

      const overlay = document.createElement('div');
      overlay.className = 'chat-settings-overlay';

      const settingsPanel = document.createElement('div');
      settingsPanel.className = 'chat-settings-panel';
      settingsPanel.dataset.theme = chatWindow.dataset.theme || 'light';

      function syncPanelTheme() {
        settingsPanel.dataset.theme = chatWindow.dataset.theme || 'light';
      }

      const themeObserver = new MutationObserver(syncPanelTheme);
      themeObserver.observe(chatWindow, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'settings-close-btn';
      closeButton.textContent = '×';
      closeButton.setAttribute('aria-label', Neura.i18n.t('closeSidebarTitle'));
      closeButton.addEventListener('click', () => {
        themeObserver.disconnect();
        document.removeEventListener('click', onDocumentClick, true);
        closeArchivedMenu();
        chatWindow.removeChild(overlay);
      });
      settingsPanel.appendChild(closeButton);

      const settingsTitle = document.createElement('h3');
      settingsTitle.className = 'settings-title';
      settingsTitle.textContent = Neura.i18n.t('settingsAccountTitle');
      settingsPanel.appendChild(settingsTitle);

      const statusLine = document.createElement('div');
      statusLine.className = 'settings-status-line';
      settingsPanel.appendChild(statusLine);

      const autosaveToast = document.createElement('div');
      autosaveToast.className = 'settings-autosave-toast';
      settingsPanel.appendChild(autosaveToast);

      let toastTimer = null;
      function showToast(message, isError = false) {
        autosaveToast.textContent = message;
        autosaveToast.classList.toggle('is-error', isError);
        autosaveToast.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          autosaveToast.classList.remove('is-visible');
        }, 2000);
      }

      const endpointLabel = document.createElement('label');
      endpointLabel.className = 'settings-label';
      endpointLabel.textContent = Neura.i18n.t('serverLabel');
      settingsPanel.appendChild(endpointLabel);

      const endpointInput = document.createElement('input');
      endpointInput.type = 'url';
      endpointInput.className = 'settings-input';
      endpointInput.placeholder = DEFAULT_API_ENDPOINT;
      settingsPanel.appendChild(endpointInput);

      const serverProbeBadge = document.createElement('div');
      serverProbeBadge.id = 'server-probe-badge';
      serverProbeBadge.className = 'settings-server-probe';
      serverProbeBadge.hidden = true;
      settingsPanel.appendChild(serverProbeBadge);

      function formatFeatureList(features) {
        if (!features || typeof features !== 'object') return '';
        const labels = {
          enable_web_search: 'Web search',
          enable_notes: 'Notes',
          enable_image_generation: 'Image generation',
          enable_code_interpreter: 'Code interpreter',
        };
        const active = Object.entries(labels)
          .filter(([key]) => features[key] === true)
          .map(([, label]) => label);
        if (active.length === 0) return '';
        return `${Neura.i18n.t('serverFeaturesLabel')}: ${active.join(', ')}`;
      }

      function renderProbeResult(result) {
        serverProbeBadge.hidden = false;
        serverProbeBadge.className = 'settings-server-probe';
        if (result?.ok) {
          serverProbeBadge.classList.add('is-ok');
          const featuresText = formatFeatureList(result.features);
          serverProbeBadge.innerHTML =
            `<strong>${Neura.i18n.t('serverOk', result.version || '?')}</strong>` +
            (featuresText ? `<br><span class="settings-server-probe-features">${featuresText}</span>` : '');
          return true;
        }
        serverProbeBadge.classList.add('is-error');
        serverProbeBadge.textContent = result?.error || Neura.i18n.t('serverNotOwui');
        return false;
      }

      function sendBackgroundMessage(payload) {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage(payload, (response) => {
            if (chrome.runtime.lastError) {
              resolve({
                ok: false,
                error: chrome.runtime.lastError.message || Neura.i18n.t('serverProbeError'),
              });
              return;
            }
            resolve(response ?? { ok: false, error: Neura.i18n.t('serverProbeError') });
          });
        });
      }

      async function wakeServiceWorker() {
        await sendBackgroundMessage({ action: 'owui:ping' });
      }

      async function runServerProbe(apiEndpoint) {
        const url = normalizeApiEndpoint(apiEndpoint);
        serverProbeBadge.hidden = false;
        serverProbeBadge.className = 'settings-server-probe is-loading';
        serverProbeBadge.textContent = Neura.i18n.t('serverProbing');

        await wakeServiceWorker();

        let lastResult = { ok: false, error: Neura.i18n.t('serverProbeError') };
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 400));
            await wakeServiceWorker();
          }
          lastResult = await sendBackgroundMessage({ action: 'owui:probeServer', apiEndpoint: url });
          if (lastResult?.ok) break;
          const err = String(lastResult?.error || '');
          const retriable =
            err.includes('Receiving end does not exist') ||
            err.includes('Could not establish connection');
          if (!retriable) break;
        }
        return renderProbeResult(lastResult);
      }

      const loggedOutSection = document.createElement('div');
      const emailLabel = document.createElement('label');
      emailLabel.className = 'settings-label';
      emailLabel.textContent = Neura.i18n.t('emailLabel');
      const emailInput = document.createElement('input');
      emailInput.type = 'text';
      emailInput.className = 'settings-input';
      emailInput.autocomplete = 'username';
      emailInput.placeholder = Neura.i18n.t('emailPlaceholder');
      const passwordLabel = document.createElement('label');
      passwordLabel.className = 'settings-label';
      passwordLabel.textContent = Neura.i18n.t('passwordLabel');
      const passwordInput = document.createElement('input');
      passwordInput.type = 'password';
      passwordInput.className = 'settings-input';
      passwordInput.autocomplete = 'current-password';
      passwordInput.placeholder = Neura.i18n.t('passwordPlaceholder');
      const loginButton = document.createElement('button');
      loginButton.type = 'button';
      loginButton.className = 'settings-btn settings-btn--primary settings-btn--block';
      loginButton.textContent = Neura.i18n.t('login');
      loggedOutSection.append(
        emailLabel,
        emailInput,
        passwordLabel,
        passwordInput,
        loginButton,
      );
      settingsPanel.appendChild(loggedOutSection);

      chrome.storage.sync.get('neuraAPIEndpoint', (data) => {
        const normalized = normalizeApiEndpoint(data.neuraAPIEndpoint);
        endpointInput.value = normalized;
        const stored = String(data.neuraAPIEndpoint || '').trim();
        if (stored && stored !== normalized) {
          chrome.storage.sync.set({ neuraAPIEndpoint: normalized });
        }
        runServerProbe(normalized);
      });

      function saveEndpoint(normalized) {
        chrome.storage.sync.set({ neuraAPIEndpoint: normalized }, () => {
          if (chrome.runtime.lastError) {
            showToast(Neura.i18n.t('preferencesSaveError'), true);
            return;
          }
          showToast(Neura.i18n.t('preferencesSaved'));
        });
      }

      endpointInput.addEventListener('change', () => {
        const normalized = normalizeApiEndpoint(endpointInput.value);
        endpointInput.value = normalized;
        saveEndpoint(normalized);
        runServerProbe(normalized);
      });

      let probeDebounce = null;
      endpointInput.addEventListener('input', () => {
        clearTimeout(probeDebounce);
        probeDebounce = setTimeout(() => {
          const normalized = normalizeApiEndpoint(endpointInput.value);
          if (normalized.startsWith('http') && normalized.includes('.')) runServerProbe(normalized);
        }, 600);
      });

      loginButton.addEventListener('click', () => {
        const apiEndpoint = normalizeApiEndpoint(endpointInput.value);
        endpointInput.value = apiEndpoint;
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!email || !password) {
          alert('Inserisci email e password.');
          return;
        }

        loginButton.disabled = true;
        loginButton.textContent = Neura.i18n.t('loggingIn');

        chrome.storage.sync.set(
          {
            neuraAPIEndpoint: apiEndpoint || DEFAULT_API_ENDPOINT,
          },
          async () => {
            const endpointToUse = apiEndpoint || DEFAULT_API_ENDPOINT;
            const probeOk = await runServerProbe(endpointToUse);
            if (!probeOk) {
              loginButton.disabled = false;
              loginButton.textContent = Neura.i18n.t('login');
              alert(serverProbeBadge.textContent || Neura.i18n.t('serverNotOwui'));
              return;
            }
            chrome.runtime.sendMessage(
              {
                action: 'auth:signin',
                email,
                password,
              },
              (response) => {
                loginButton.disabled = false;
                loginButton.textContent = Neura.i18n.t('login');
                if (chrome.runtime.lastError || !response?.ok) {
                  alert(response?.error || 'Login fallito. Verifica credenziali e server.');
                  return;
                }
                passwordInput.value = '';
                setLoggedInUi(response.user);
                if (Neura.ui?.refreshHeaderModelSelect) {
                  Neura.ui.refreshHeaderModelSelect().catch(() => {});
                }
              },
            );
          },
        );
      });

      const logoutButton = document.createElement('button');
      logoutButton.type = 'button';
      logoutButton.className = 'settings-btn settings-btn--outline settings-btn--block';
      logoutButton.textContent = Neura.i18n.t('logout');
      logoutButton.style.display = 'none';
      logoutButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'auth:signout' }, (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            alert(response?.error || 'Errore durante il logout.');
            return;
          }
          setLoggedOutUi();
        });
      });

      const uiLanguageLabel = document.createElement('label');
      uiLanguageLabel.className = 'settings-label';
      uiLanguageLabel.textContent = Neura.i18n.t('uiLanguageLabel');
      const uiLanguageSelect = document.createElement('select');
      uiLanguageSelect.className = 'settings-input';
      const supported =
        (Neura.i18n.SUPPORTED_LOCALES && Neura.i18n.SUPPORTED_LOCALES.slice()) || [
          'it',
          'en',
          'es',
          'fr',
          'de',
          'zh',
          'pt',
          'hi',
        ];
      const labels = Neura.i18n.LOCALE_LABELS || {};
      const currentLocale = Neura.i18n.getLocale ? Neura.i18n.getLocale() : 'it';
      for (const code of supported) {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = labels[code] || code;
        if (code === currentLocale) opt.selected = true;
        uiLanguageSelect.appendChild(opt);
      }
      const uiLanguageHint = document.createElement('p');
      uiLanguageHint.className = 'settings-hint settings-hint--tight';
      uiLanguageHint.textContent = Neura.i18n.t('uiLanguageHint');

      uiLanguageSelect.addEventListener('change', async () => {
        const nextLocale = (uiLanguageSelect.value || 'it').trim();
        if (nextLocale === Neura.i18n.getLocale()) return;
        chrome.storage.sync.set({ neuraLocale: nextLocale }, async () => {
          if (chrome.runtime.lastError) {
            showToast(Neura.i18n.t('preferencesSaveError'), true);
            return;
          }
          if (Neura.i18n.setLocale) await Neura.i18n.setLocale(nextLocale);
          showToast(Neura.i18n.t('preferencesSaved'));
          if (Neura.chat && typeof Neura.chat.reinitialize === 'function') {
            Neura.chat.reinitialize().catch(() => {});
          }
        });
      });

      settingsPanel.append(uiLanguageLabel, uiLanguageSelect, uiLanguageHint);

      function setLoggedInUi(user) {
        loggedOutSection.style.display = 'none';
        logoutButton.style.display = 'block';
        const name = user?.name || user?.email || user?.username || 'Utente';
        statusLine.textContent = Neura.i18n.t('connectedAs', name);
      }

      function setLoggedOutUi() {
        loggedOutSection.style.display = 'block';
        logoutButton.style.display = 'none';
        statusLine.textContent = Neura.i18n.t('notConnected');
      }

      const archivedChatsBtn = document.createElement('button');
      archivedChatsBtn.type = 'button';
      archivedChatsBtn.className = 'settings-btn settings-btn--outline settings-btn--block';
      archivedChatsBtn.textContent = Neura.i18n.t('archivedChats');
      const archivedChatsPanel = document.createElement('div');
      archivedChatsPanel.className = 'settings-archived-panel';
      archivedChatsPanel.hidden = true;

      let archivedMenuEl = null;

      function closeArchivedMenu() {
        if (archivedMenuEl) {
          archivedMenuEl.remove();
          archivedMenuEl = null;
        }
      }

      function openArchivedMenu(anchorBtn, chat) {
        closeArchivedMenu();
        const menu = document.createElement('div');
        menu.className = 'chat-sidebar-item-menu settings-archived-item-menu';
        menu.dataset.chatKey = chat.remoteId || chat.id || '';

        const addItem = (label, onClick, opts = {}) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'chat-sidebar-item-menu-btn';
          if (opts.danger) btn.classList.add('danger');
          btn.textContent = label;
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            closeArchivedMenu();
            await onClick();
          });
          menu.appendChild(btn);
        };

        addItem(Neura.i18n.t('unarchiveChat'), async () => {
          const res = await sendSettingsAction('chats:archive', {
            localChatId: chat.id,
            remoteId: chat.remoteId,
          });
          if (res.ok) {
            await renderArchivedChatsList();
            if (Neura.chatSidebar?.refresh) Neura.chatSidebar.refresh();
          } else if (res.error === 'not_synced') {
            alert(Neura.i18n.t('chatNotSyncedYet'));
          } else {
            alert(res.error || Neura.i18n.t('chatNotSyncedYet'));
          }
        });

        addItem(
          Neura.i18n.t('deleteChat'),
          async () => {
            if (!confirm(Neura.i18n.t('deleteConfirmChat'))) return;
            const res = await sendSettingsAction('chats:delete', {
              localChatId: chat.id,
              remoteId: chat.remoteId,
            });
            if (chat.id) {
              try {
                await Neura.localChats.remove(chat.id);
              } catch (e) {}
              const activeId = await Neura.localChats.getActiveId();
              if (chat.id === activeId) await Neura.session.createNewChat();
            }
            if (res.ok) {
              await renderArchivedChatsList();
              if (Neura.chatSidebar?.refresh) Neura.chatSidebar.refresh();
            } else {
              alert(res.error || Neura.i18n.t('deleteConfirmChat'));
            }
          },
          { danger: true },
        );

        if (chatWindow.dataset.theme) {
          menu.dataset.theme = chatWindow.dataset.theme;
        }
        shadowRoot.appendChild(menu);
        const rect = anchorBtn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${Math.max(8, rect.right - 200)}px`;
        menu.style.zIndex = '10001';
        archivedMenuEl = menu;
      }

      async function openArchivedChat(chat) {
        if (chat.id) {
          await Neura.session.loadChat(chat.id);
        } else if (chat.remoteId) {
          const loaded = await sendSettingsAction('chats:get', { remoteId: chat.remoteId });
          if (loaded?.ok && loaded.localId) await Neura.session.loadChat(loaded.localId);
        }
        themeObserver.disconnect();
        document.removeEventListener('click', onDocumentClick, true);
        closeArchivedMenu();
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }

      async function renderArchivedChatsList() {
        closeArchivedMenu();
        archivedChatsPanel.innerHTML = `<div class="settings-archived-loading">${Neura.i18n.t('loading')}</div>`;
        const res = await sendSettingsAction('chats:archivedList');
        const items = (res.ok ? res.items || [] : []).map((raw) => ({
          id: null,
          remoteId: raw.id || raw.chat_id || null,
          title: raw.title || Neura.i18n.t('newChat'),
        }));
        archivedChatsPanel.innerHTML = '';
        if (!items.length) {
          const empty = document.createElement('p');
          empty.className = 'settings-archived-empty';
          empty.textContent = Neura.i18n.t('noArchivedChats');
          archivedChatsPanel.appendChild(empty);
          return;
        }
        for (const chat of items) {
          const row = document.createElement('div');
          row.className = 'settings-archived-row';

          const openBtn = document.createElement('button');
          openBtn.type = 'button';
          openBtn.className = 'settings-archived-item';
          const { emoji, text } = extractLeadingEmoji(chat.title);
          const emojiSpan = document.createElement('span');
          emojiSpan.className = 'settings-archived-emoji';
          emojiSpan.textContent = emoji;
          const titleSpan = document.createElement('span');
          titleSpan.className = 'settings-archived-title';
          titleSpan.textContent = text;
          openBtn.appendChild(emojiSpan);
          openBtn.appendChild(titleSpan);
          openBtn.addEventListener('click', () => {
            openArchivedChat(chat);
          });

          const menuBtn = document.createElement('button');
          menuBtn.type = 'button';
          menuBtn.className = 'settings-archived-menu-btn';
          menuBtn.title = Neura.i18n.t('chatOptions');
          menuBtn.setAttribute('aria-label', Neura.i18n.t('chatOptions'));
          menuBtn.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';
          menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const chatKey = chat.remoteId || chat.id || '';
            if (archivedMenuEl?.dataset.chatKey === chatKey) {
              closeArchivedMenu();
              return;
            }
            openArchivedMenu(menuBtn, chat);
          });

          row.appendChild(openBtn);
          row.appendChild(menuBtn);
          archivedChatsPanel.appendChild(row);
        }
      }

      function onDocumentClick(e) {
        if (!archivedMenuEl) return;
        if (archivedMenuEl.contains(e.target)) return;
        if (e.target.closest('.settings-archived-menu-btn')) return;
        closeArchivedMenu();
      }

      document.addEventListener('click', onDocumentClick, true);

      archivedChatsBtn.addEventListener('click', async () => {
        const willShow = archivedChatsPanel.hidden;
        archivedChatsPanel.hidden = !willShow;
        if (willShow) {
          await renderArchivedChatsList();
        } else {
          closeArchivedMenu();
        }
      });

      settingsPanel.append(archivedChatsBtn, archivedChatsPanel);

      const privacyNote = document.createElement('p');
      privacyNote.className = 'settings-hint settings-hint--privacy';
      privacyNote.textContent = Neura.i18n.t('privacyNote');
      settingsPanel.appendChild(privacyNote);

      const deleteAllChatsWrap = document.createElement('div');
      deleteAllChatsWrap.className = 'settings-danger-section';
      const deleteAllChatsButton = document.createElement('button');
      deleteAllChatsButton.type = 'button';
      deleteAllChatsButton.className = 'settings-btn settings-btn--danger';
      deleteAllChatsButton.textContent = Neura.i18n.t('deleteAllChats');
      deleteAllChatsButton.addEventListener('click', async () => {
        if (!confirm(Neura.i18n.t('deleteAllChatsConfirm'))) return;
        try {
          const remoteResult = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage({ action: 'chats:deleteAll' }, (res) => {
                resolve(chrome.runtime.lastError ? { ok: false } : res);
              });
            } catch (e) {
              resolve({ ok: false });
            }
          });
          // Local non-pinned chats are already cleaned by the background handler;
          // do not call removeAll() or pinned chats would be wiped too.
          const keptLocalIds = Array.isArray(remoteResult?.keptLocalIds)
            ? remoteResult.keptLocalIds
            : [];
          const activeId = await Neura.localChats.getActiveId();
          if (activeId && !keptLocalIds.includes(activeId)) {
            await Neura.localChats.setActiveId(null);
          }
          await Neura.session.createNewChat();
          if (Neura.chatSidebar?.refresh) Neura.chatSidebar.refresh();
          if (remoteResult?.ok) {
            alert(Neura.i18n.t('deleteAllChatsDone'));
          } else {
            alert(Neura.i18n.t('deleteAllChatsPartial'));
          }
        } catch (e) {
          alert(Neura.i18n.t('deleteAllChatsError'));
        }
      });
      deleteAllChatsWrap.appendChild(deleteAllChatsButton);

      settingsPanel.appendChild(logoutButton);
      settingsPanel.appendChild(deleteAllChatsWrap);

      chrome.runtime.sendMessage({ action: 'auth:status' }, (status) => {
        if (status?.loggedIn) {
          setLoggedInUi(status.user);
        } else {
          setLoggedOutUi();
        }
      });

      overlay.appendChild(settingsPanel);
      chatWindow.appendChild(overlay);
    },
  };
})(window.Neura);
