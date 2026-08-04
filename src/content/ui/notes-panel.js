(function (Neura) {
  function sendAction(action, extra = {}) {
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

  function setComposerVisible(visible) {
    const inputWrapper = Neura.shadow.$('input-wrapper');
    if (inputWrapper) inputWrapper.style.display = visible ? '' : 'none';
  }

  function setChatChromeVisible(visible) {
    const toggles = Neura.shadow.$('composer-toolbar');
    if (toggles) toggles.style.visibility = visible ? '' : 'hidden';
  }

  Neura.notesPanel = {
    async open(noteId) {
      Neura.state.panelMode = 'note';
      Neura.state.activeNoteId = noteId || null;

      const messageArea = Neura.shadow.$('message-area');
      const titleEl = Neura.shadow.$('chat-title');
      if (!messageArea) return;

      setComposerVisible(false);
      setChatChromeVisible(false);

      messageArea.innerHTML = '';
      messageArea.classList.add('notes-panel-active');

      const shell = document.createElement('div');
      shell.className = 'notes-panel';
      shell.id = 'notes-panel';

      const toolbar = document.createElement('div');
      toolbar.className = 'notes-panel-toolbar';

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'notes-panel-title';
      titleInput.placeholder = Neura.i18n.t('noteTitlePlaceholder');
      titleInput.id = 'notes-panel-title';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'notes-panel-btn primary';
      saveBtn.textContent = Neura.i18n.t('noteSave');

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'notes-panel-btn danger';
      deleteBtn.textContent = Neura.i18n.t('noteDelete');

      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'notes-panel-btn notes-panel-back';
      backBtn.title = Neura.i18n.t('noteBack');
      backBtn.setAttribute('aria-label', Neura.i18n.t('noteBack'));
      backBtn.innerHTML =
        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>` +
        `<span>${Neura.i18n.t('noteBack')}</span>`;

      // Wired up immediately (rather than after the async note load below) so
      // the user is never stuck in this panel with no way out — even if
      // loading an existing note fails, "Indietro" must always work.
      backBtn.addEventListener('click', () => {
        this.close({ restoreChat: true });
      });

      toolbar.appendChild(backBtn);
      toolbar.appendChild(titleInput);
      toolbar.appendChild(saveBtn);
      toolbar.appendChild(deleteBtn);

      const editor = document.createElement('textarea');
      editor.className = 'notes-panel-editor';
      editor.id = 'notes-panel-editor';
      editor.placeholder = Neura.i18n.t('noteContentPlaceholder');

      const status = document.createElement('div');
      status.className = 'notes-panel-status';
      status.id = 'notes-panel-status';

      shell.appendChild(toolbar);
      shell.appendChild(editor);
      shell.appendChild(status);
      messageArea.appendChild(shell);

      let note = null;
      if (noteId) {
        status.textContent = Neura.i18n.t('noteLoading');
        const res = await sendAction('notes:get', { noteId });
        if (!res.ok || !res.note) {
          status.textContent = res.error || Neura.i18n.t('noteLoadError');
          return;
        }
        note = res.note;
      } else {
        note = { id: null, title: Neura.i18n.t('noteUntitled'), markdown: '' };
      }

      Neura.state.activeNoteId = note.id || null;
      titleInput.value = note.title || '';
      editor.value = note.markdown || '';
      if (titleEl) titleEl.textContent = note.title || Neura.i18n.t('tabNotes');
      status.textContent = '';

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        status.textContent = Neura.i18n.t('noteSaving');
        try {
          const payload = {
            title: titleInput.value.trim() || Neura.i18n.t('noteUntitled'),
            markdown: editor.value,
          };
          let res;
          if (Neura.state.activeNoteId) {
            res = await sendAction('notes:update', {
              noteId: Neura.state.activeNoteId,
              ...payload,
            });
          } else {
            res = await sendAction('notes:create', payload);
          }
          if (!res.ok || !res.note) throw new Error(res.error || 'Save failed');
          Neura.state.activeNoteId = res.note.id;
          titleInput.value = res.note.title || payload.title;
          if (titleEl) titleEl.textContent = titleInput.value;
          status.textContent = Neura.i18n.t('noteSaved');
          if (Neura.chatSidebar) Neura.chatSidebar.refresh();
        } catch (e) {
          status.textContent = String(e.message || e);
        } finally {
          saveBtn.disabled = false;
        }
      });

      deleteBtn.addEventListener('click', async () => {
        if (!Neura.state.activeNoteId) {
          this.close({ restoreChat: true });
          return;
        }
        if (!confirm(Neura.i18n.t('noteDeleteConfirm'))) return;
        const res = await sendAction('notes:delete', { noteId: Neura.state.activeNoteId });
        if (!res.ok) {
          status.textContent = res.error || Neura.i18n.t('noteDeleteError');
          return;
        }
        if (Neura.chatSidebar) Neura.chatSidebar.refresh();
        this.close({ restoreChat: true });
      });
    },

    isActive() {
      return Neura.state.panelMode === 'note';
    },

    close({ restoreChat = true } = {}) {
      if (Neura.state.panelMode !== 'note' && !Neura.shadow.$('notes-panel')) return;
      Neura.state.panelMode = 'chat';
      Neura.state.activeNoteId = null;
      const messageArea = Neura.shadow.$('message-area');
      if (messageArea) {
        messageArea.classList.remove('notes-panel-active');
        messageArea.innerHTML = '';
      }
      setComposerVisible(true);
      setChatChromeVisible(true);
      if (Neura.chatSidebar?.exitNotesMode) Neura.chatSidebar.exitNotesMode();
      if (restoreChat && Neura.session?.loadSessionMessages) {
        Neura.session.loadSessionMessages();
      }
    },
  };
})(window.Neura);
