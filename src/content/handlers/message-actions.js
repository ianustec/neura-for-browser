(function (Neura) {
  /**
   * Every message (user or assistant) is its own top-level sibling in the
   * message area, so editing/deleting a user message must walk and collect
   * *every* following sibling — not just the single next one — to match
   * `Neura.localChats.truncateFrom()`, which drops the message and
   * everything after it in storage.
   * @param {Element} afterContainer
   * @returns {Element[]}
   */
  function collectFollowingMessages(afterContainer) {
    const following = [];
    let node = afterContainer.nextElementSibling;
    while (node) {
      following.push(node);
      node = node.nextElementSibling;
    }
    return following;
  }

  function reattachUserButtons(messageDiv, text) {
    const messageContainer = messageDiv.parentElement;
    const existing = messageContainer.querySelector('.message-actions');
    if (existing) existing.remove();

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'message-action-btn edit-btn';
    editBtn.title = Neura.i18n.t('editMessage');
    editBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>`;
    editBtn.onclick = (e) => {
      e.stopPropagation();
      Neura.messageActions.editUserMessage(messageDiv, text);
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'message-action-btn delete-btn';
    deleteBtn.title = Neura.i18n.t('deleteMessage');
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3,6 5,6 21,6"></polyline>
        <path d="M19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>`;
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      Neura.messageActions.deleteUserMessage(messageContainer);
    };

    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(deleteBtn);
    messageContainer.appendChild(actionsDiv);
  }

  Neura.messageActions = {
    copyAssistantMessage(text, button) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          const originalHTML = button.innerHTML;
          button.classList.add('copied');
          button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20,6 9,17 4,12"></polyline>
            </svg>`;
          setTimeout(() => {
            button.classList.remove('copied');
            button.innerHTML = originalHTML;
          }, 2000);
        })
        .catch(() => {
          const originalHTML = button.innerHTML;
          button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>`;
          setTimeout(() => {
            button.innerHTML = originalHTML;
          }, 2000);
        });
    },

    editUserMessage(messageDiv, originalText) {
      if (messageDiv.classList.contains('edit-mode')) return;
      const contentDiv = messageDiv.querySelector('div');
      const originalContent = contentDiv.innerHTML;
      messageDiv.classList.add('edit-mode');

      const editInput = document.createElement('textarea');
      editInput.className = 'edit-input';
      editInput.value = originalText;
      editInput.rows = Math.max(2, originalText.split('\n').length);

      const editActions = document.createElement('div');
      editActions.className = 'edit-actions';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'edit-save-btn';
      saveBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20,6 9,17 4,12"></polyline>
        </svg>
        ${Neura.i18n.t('save')}`;
      saveBtn.onclick = (e) => {
        e.stopPropagation();
        Neura.messageActions.saveEditedMessage(messageDiv, editInput.value, originalContent);
      };

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'edit-cancel-btn';
      cancelBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
        ${Neura.i18n.t('cancel')}`;
      cancelBtn.onclick = (e) => {
        e.stopPropagation();
        Neura.messageActions.cancelEdit(messageDiv, originalContent, originalText);
      };

      editActions.appendChild(saveBtn);
      editActions.appendChild(cancelBtn);
      contentDiv.innerHTML = '';
      contentDiv.appendChild(editInput);
      contentDiv.appendChild(editActions);
      editInput.focus();
      editInput.select();

      editInput.addEventListener('keydown', async (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          await Neura.messageActions.saveEditedMessage(messageDiv, editInput.value, originalContent);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          Neura.messageActions.cancelEdit(messageDiv, originalContent, originalText);
        }
        if (e.ctrlKey && e.key === 'a') {
          e.preventDefault();
          editInput.select();
        }
      });
    },

    async saveEditedMessage(messageDiv, newText, originalContent) {
      if (!newText.trim()) {
        Neura.messageActions.cancelEdit(messageDiv, originalContent, '');
        return;
      }
      messageDiv.classList.remove('edit-mode');
      const contentDiv = messageDiv.querySelector('div');
      const escapedText = Neura.markdown.escapeHtml(newText);
      contentDiv.innerHTML = escapedText.replace(/ /g, '&nbsp;').replace(/\n/g, '<br>');
      reattachUserButtons(messageDiv, newText);

      const messageContainer = messageDiv.parentElement;
      for (const el of collectFollowingMessages(messageContainer)) el.remove();

      const messageId = messageDiv.dataset.messageId || messageContainer.dataset.messageId;
      const chatId = Neura.session.getActiveChatId();
      if (chatId && messageId) {
        await Neura.localChats.truncateFrom(chatId, messageId);
        try {
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'chats:push', localChatId: chatId }, resolve);
          });
        } catch (e) {}
      }
      await Neura.streaming.sendMessageToBackground('sendMessageToOpenWebUI', newText, {
        userMessageEl: { container: messageContainer, div: messageDiv },
      });
    },

    cancelEdit(messageDiv, originalContent, originalText) {
      messageDiv.classList.remove('edit-mode');
      const contentDiv = messageDiv.querySelector('div');
      contentDiv.innerHTML = originalContent;
      reattachUserButtons(messageDiv, originalText || originalContent.replace(/&nbsp;/g, ' ').replace(/<br>/g, '\n'));
    },

    async deleteUserMessage(messageContainer) {
      const messageId = messageContainer.dataset.messageId;
      const chatId = Neura.session.getActiveChatId();
      const toRemove = [messageContainer, ...collectFollowingMessages(messageContainer)];

      for (const el of toRemove) {
        el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        el.style.opacity = '0';
        el.style.transform = 'translateX(100%)';
      }

      setTimeout(async () => {
        for (const el of toRemove) {
          if (el.parentNode) el.parentNode.removeChild(el);
        }

        if (chatId && messageId) {
          await Neura.localChats.truncateFrom(chatId, messageId);
          try {
            await new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: 'chats:push', localChatId: chatId }, resolve);
            });
          } catch (e) {}
          if (Neura.chatSidebar) Neura.chatSidebar.refresh();
        }
      }, 300);
    },
  };
})(window.Neura);
