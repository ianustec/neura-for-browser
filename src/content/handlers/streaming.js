(function (Neura) {
  const st = () => Neura.state;

  function maybeVoiceChatScroll() {
    if (Neura.voiceMode?.isActive?.() && Neura.voiceOverlay?.isChatExpanded?.()) {
      Neura.voiceChatSlot?.scrollToBottom?.();
    }
  }

  /** User intent for the *next* message — always read from the toggle, not state.agentMode
   *  (state can be flipped silently during an active agent session). */
  function isAgentModeEnabledFromUi() {
    const btn = Neura.shadow.$('agent-toggle-btn');
    if (btn) return btn.dataset.active === 'true';
    return !!Neura.state.agentMode;
  }

  function syncAgentModeFromUi() {
    const enabled = isAgentModeEnabledFromUi();
    Neura.state.agentMode = enabled;
    return enabled;
  }

  /** @type {{ turnId: string, chatId: string|null, port: chrome.runtime.Port, contentDiv: HTMLElement, contentWrapper: HTMLElement, messageDiv: HTMLElement, agentMode: boolean }|null} */
  let activeStream = null;

  function makeTurnId() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `turn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function clearActiveStreamGlobals() {
    const s = st();
    s.streamingPort = null;
    s.currentStreamingMessageElement = null;
    s.currentStreamingMessageWrapper = null;
    s.currentStreamingContent = '';
    s.currentStreamingMessageDiv = null;
    s.agentRunning = false;
  }

  function abortActiveStream() {
    if (!activeStream) return;
    const stream = activeStream;
    activeStream = null;

    if (stream.contentWrapper) {
      Neura.messages.removeStatusChip(stream.contentWrapper, { immediate: true });
      Neura.messages.finalizeAllThoughtBlocks
        ? Neura.messages.finalizeAllThoughtBlocks(stream.contentWrapper, { collapse: true })
        : Neura.messages.finalizeThoughtBlock(stream.contentWrapper, { collapse: true });
    }

    try {
      if (stream.agentMode) {
        stream.port.postMessage({ action: 'abortAgent' });
      } else {
        stream.port.postMessage({ action: 'abortStream' });
      }
    } catch (e) {}

    try {
      stream.port.disconnect();
    } catch (e) {}

    if (Neura.agentLog) Neura.agentLog.endSession();
    clearActiveStreamGlobals();
    Neura.messages.toggleSendIcon('send');
  }

  function abortStreamingFromUi() {
    const s = st();
    if (activeStream) {
      const stream = activeStream;
      if (stream.contentDiv && s.currentStreamingContent && s.currentStreamingContent.trim()) {
        const wasAgent = stream.agentMode;
        const finalContent = wasAgent
          ? `${s.currentStreamingContent}\n\n---\n\n${Neura.i18n.t('agentStopped')}`
          : `${s.currentStreamingContent}\n\n---\n\n${Neura.i18n.t('generationStopped')}`;
        stream.contentDiv.innerHTML = Neura.markdown.parseMarkdown(finalContent);
        Neura.markdown.highlightCodeBlocks(stream.contentDiv);
        Neura.session.clearAssistantDraft();
        if (stream.messageDiv) {
          attachAssistantCopyButton(stream.messageDiv, finalContent);
        }
      }
      abortActiveStream();
      return;
    }

    if (s.currentStreamingMessageWrapper) {
      Neura.messages.removeStatusChip(s.currentStreamingMessageWrapper, { immediate: true });
      Neura.messages.finalizeAllThoughtBlocks
        ? Neura.messages.finalizeAllThoughtBlocks(s.currentStreamingMessageWrapper, { collapse: true })
        : Neura.messages.finalizeThoughtBlock(s.currentStreamingMessageWrapper, { collapse: true });
    }

    if (s.currentStreamingMessageElement) {
      let finalContent;
      const wasAgent = s.agentRunning;
      if (s.currentStreamingContent && s.currentStreamingContent.trim()) {
        finalContent = wasAgent
          ? `${s.currentStreamingContent}\n\n---\n\n${Neura.i18n.t('agentStopped')}`
          : `${s.currentStreamingContent}\n\n---\n\n${Neura.i18n.t('generationStopped')}`;
      } else {
        finalContent = wasAgent
          ? Neura.i18n.t('agentStopped')
          : Neura.i18n.t('generationStopped');
      }
      s.currentStreamingMessageElement.innerHTML = Neura.markdown.parseMarkdown(finalContent);
      Neura.markdown.highlightCodeBlocks(s.currentStreamingMessageElement);
      Neura.session.clearAssistantDraft();
      if (s.currentStreamingMessageDiv) {
        attachAssistantCopyButton(s.currentStreamingMessageDiv, finalContent);
      }
    }

    if (s.streamingPort) {
      if (s.agentRunning) {
        s.streamingPort.postMessage({ action: 'abortAgent' });
      } else {
        s.streamingPort.postMessage({ action: 'abortStream' });
      }
      try {
        s.streamingPort.disconnect();
      } catch (e) {}
    }

    if (Neura.agentLog) Neura.agentLog.endSession();
    clearActiveStreamGlobals();
    Neura.messages.toggleSendIcon('send');
  }

  function attachAssistantCopyButton(messageDiv, text) {
    const messageContainer = messageDiv.parentElement;
    if (!messageContainer || messageContainer.querySelector('.message-actions')) return;
    Neura.messages.attachAssistantActions(messageContainer, text);
  }

  /**
   * Swap the transient spinner icon for the real assistant/model avatar —
   * the same `<img class="assistant-avatar">` history rendering uses — so a
   * live-streamed reply ends up with the model logo instead of a faint
   * placeholder ring that has no icon at all.
   *
   * `modelId` is the model that actually produced *this* message (captured
   * once when the turn started), not whatever model happens to be active
   * when the icon is swapped — the two can differ if the user switches
   * models while a reply is still streaming.
   * @param {HTMLElement|null|undefined} messageDiv
   * @param {string} [modelId]
   */
  function hideStreamingIcon(messageDiv, modelId) {
    if (!messageDiv) return;
    const streamingIcon = messageDiv.querySelector('.streaming-icon, .message-icon');
    if (!streamingIcon) return;

    const iconImg = document.createElement('img');
    iconImg.className = 'assistant-avatar';
    iconImg.src = Neura.branding?.getAssistantIconSrc?.() || Neura.paths.iconWhite;
    iconImg.style.cssText =
      'height: 20px; width: 20px; margin-right: 10px; border-radius: 4px; object-fit: contain; flex-shrink: 0;';
    const resolvedModel = modelId || Neura.modelIcons?.getActiveModel?.();
    if (resolvedModel && Neura.modelIcons) {
      Neura.modelIcons.applyToImg(iconImg, resolvedModel);
    }
    streamingIcon.replaceWith(iconImg);
  }

  function buildAssistantBubble(initialContent = '') {
    const messageArea = Neura.shadow.$('message-area');
    if (!messageArea) return null;

    const messageContainer = document.createElement('div');
    messageContainer.className = 'message-container';

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant-message';

    const iconDiv = document.createElement('div');
    iconDiv.className = 'message-icon streaming-icon';
    iconDiv.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" fill="none" opacity="0.2"/>
        <path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>`;
    messageDiv.appendChild(iconDiv);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content-wrapper';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    if (initialContent) {
      contentDiv.innerHTML = Neura.markdown.parseMarkdown(initialContent);
      Neura.markdown.highlightCodeBlocks(contentDiv);
    }
    contentWrapper.appendChild(contentDiv);
    messageDiv.appendChild(contentWrapper);

    messageContainer.appendChild(messageDiv);
    messageArea.appendChild(messageContainer);
    if (st().autoScrollEnabled) messageArea.scrollTop = messageArea.scrollHeight;
    maybeVoiceChatScroll();

    return { messageContainer, messageDiv, contentWrapper, contentDiv, messageArea };
  }

  let draftTimer = null;
  function scheduleDraftSave() {
    if (draftTimer) return;
    draftTimer = setTimeout(() => {
      draftTimer = null;
      const s = st();
      if (s.currentStreamingContent && Neura.session && Neura.session.setAssistantDraft) {
        Neura.session.setAssistantDraft(s.currentStreamingContent);
      }
    }, 400);
  }

  function installPortListener(port, ctx) {
    const s = st();
    const turnId = ctx.turnId || null;
    let fullContent = ctx.initialContent || '';
    let thoughtFinalized = !!ctx.initialContent;
    /** @type {object[]} */
    let collectedFiles = Array.isArray(ctx.initialFiles) ? [...ctx.initialFiles] : [];
    let reasoningSplitter = Neura.reasoningSplitter
      ? Neura.reasoningSplitter.createReasoningStreamSplitter()
      : null;
    const contentDiv = ctx.contentDiv;
    const messageArea = ctx.messageArea;
    const messageDiv = ctx.messageDiv;
    const wrapper = ctx.contentWrapper;
    // The model that is actually producing this reply — captured once so it
    // stays correct even if the user switches models while streaming.
    const turnModelId = Neura.modelIcons?.getActiveModel?.() || '';
    const hideIcon = (div) => hideStreamingIcon(div, turnModelId);

    if (turnId && contentDiv) {
      activeStream = {
        turnId,
        chatId: ctx.chatId || null,
        port,
        contentDiv,
        contentWrapper: wrapper,
        messageDiv,
        agentMode: !!ctx.agentMode,
      };
      s.streamingPort = port;
      s.currentStreamingMessageElement = contentDiv;
      s.currentStreamingMessageWrapper = wrapper;
      s.currentStreamingMessageDiv = messageDiv;
      s.currentStreamingContent = fullContent;
      s.agentRunning = !!ctx.agentMode;
    }

    function isActiveTurn(response) {
      if (response?.turnId && turnId && response.turnId !== turnId) return false;
      if (!turnId) return activeStream?.port === port;
      return activeStream?.turnId === turnId;
    }

    /** @type {{ kind: 'reasoning', text: string } | { kind: 'tool', name: string, callId?: string }[]} */
    let thoughtTimeline = [];
    let pendingReasoning = '';
    let usingOutputSteps = false;

    function renderOutputStepsIfAvailable(items, opts = {}) {
      if (!wrapper || !Array.isArray(items) || items.length === 0) return false;
      if (!Neura.owuiOutput?.renderOutputSteps) return false;
      const rendered = Neura.owuiOutput.renderOutputSteps(wrapper, items, {
        autoOpenWhileRunning: opts.autoOpenWhileRunning !== false,
      });
      if (rendered) {
        usingOutputSteps = true;
        thoughtFinalized = true;
        if (s.autoScrollEnabled && messageArea) messageArea.scrollTop = messageArea.scrollHeight;
      }
      return rendered;
    }

    function flushReasoningToTimeline() {
      const text = pendingReasoning.trim();
      if (!text) return;
      thoughtTimeline.push({ kind: 'reasoning', text });
      pendingReasoning = '';
    }

    function pushToolToTimeline(name, callId) {
      const toolName = String(name || '').trim();
      if (!toolName) return;
      const last = thoughtTimeline[thoughtTimeline.length - 1];
      if (last?.kind === 'tool' && last.name === toolName && (!callId || last.callId === callId)) {
        return;
      }
      thoughtTimeline.push({ kind: 'tool', name: toolName, callId: callId || toolName });
    }

    function appendReasoningDelta(text) {
      if (!wrapper || !text) return;
      pendingReasoning += text;
      Neura.messages.appendThoughtContent(wrapper, text);
    }

    function ingestStructuredReasoning(text) {
      if (!wrapper || !text) return;
      const parts = Neura.messages.expandReasoningSegments
        ? Neura.messages.expandReasoningSegments(text)
        : [String(text).trim()].filter(Boolean);
      let reasoningBatch = [];
      const flushReasoningBatch = () => {
        const merged = reasoningBatch.join('\n\n').trim();
        reasoningBatch = [];
        if (!merged) return;
        pendingReasoning = pendingReasoning ? `${pendingReasoning}\n\n${merged}` : merged;
        Neura.messages.appendThoughtContent(wrapper, merged);
      };
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const toolMatch = trimmed.match(/^🔧\s*(.+)$/);
        if (toolMatch && !trimmed.includes('\n')) {
          flushReasoningBatch();
          flushReasoningToTimeline();
          const name = toolMatch[1].trim();
          pushToolToTimeline(name);
          Neura.messages.finalizeActiveThoughtBlock(wrapper, { collapse: true });
          const exploredEl = Neura.messages.appendExploredTool(wrapper, name, name);
          Neura.messages.reorderExploredBeforeLastThought(wrapper, exploredEl);
          Neura.messages.upsertToolResultBlock(wrapper, {
            name,
            callId: name,
            status: 'done',
          });
          continue;
        }
        reasoningBatch.push(trimmed);
      }
      flushReasoningBatch();
    }

    function resolveThoughtFromDone(partitionedThought, streamReasoning) {
      flushReasoningToTimeline();
      const fromTimeline = Neura.messages.buildStructuredThoughtText
        ? Neura.messages.buildStructuredThoughtText(thoughtTimeline)
        : '';
      const streamText = fromTimeline || String(streamReasoning || '').trim();
      if (Neura.messages.mergeThoughtFromDone) {
        return Neura.messages.mergeThoughtFromDone(partitionedThought, streamText);
      }
      return String(partitionedThought || streamText || '').trim();
    }

    function appendReasoning(text, structured = false) {
      if (!wrapper || !text) return;
      if (structured || /(?:^|\n)🔧\s/.test(text) || text.includes('<details')) {
        ingestStructuredReasoning(text);
      } else {
        appendReasoningDelta(text);
      }
    }

    function finalizeThoughts(opts = { collapse: true }) {
      if (!wrapper) return;
      if (Neura.messages.finalizeAllThoughtBlocks) {
        Neura.messages.finalizeAllThoughtBlocks(wrapper, opts);
      } else {
        Neura.messages.finalizeThoughtBlock(wrapper, opts);
      }
    }

    function syncGlobalsFromContent() {
      if (!isActiveTurn({ turnId })) return;
      s.currentStreamingContent = fullContent;
    }

    function mergeCollectedFiles(items) {
      if (!Array.isArray(items) || items.length === 0) return;
      const seen = new Set(collectedFiles.map((f) => f.url || f.id || ''));
      for (const f of items) {
        if (!f) continue;
        const key = f.url || f.id || '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        collectedFiles.push(f);
      }
    }

    function saveAssistantMessage(content) {
      const toSave = content || '';
      const hasFiles = collectedFiles.length > 0;
      if ((!toSave && !hasFiles) || !ctx.chatId) {
        if (Neura.chatSidebar) Neura.chatSidebar.refresh();
        return;
      }
      const payload = { role: 'assistant', content: toSave };
      if (hasFiles) payload.files = collectedFiles;
      if (turnModelId) payload.model = turnModelId;
      Neura.localChats.addMessage(ctx.chatId, payload).then((msg) => {
        if (msg && messageDiv) messageDiv.dataset.messageId = msg.id;
        if (msg && ctx.messageContainer) ctx.messageContainer.dataset.messageId = msg.id;
        if (Neura.chatSidebar) Neura.chatSidebar.refresh();
      });
    }

    let renderScheduled = false;
    function applyRender() {
      if (!contentDiv || !isActiveTurn({ turnId })) return;
      contentDiv.innerHTML = Neura.markdown.parseMarkdown(fullContent);
      Neura.markdown.highlightCodeBlocks(contentDiv);
      hideIcon(messageDiv);
      if (s.autoScrollEnabled && messageArea) messageArea.scrollTop = messageArea.scrollHeight;
      maybeVoiceChatScroll();
    }
    function renderNow() {
      applyRender();
      if (isActiveTurn({ turnId })) scheduleDraftSave();
    }
    function scheduleRender() {
      if (renderScheduled) return;
      renderScheduled = true;
      requestAnimationFrame(() => {
        renderScheduled = false;
        renderNow();
      });
    }

    function cleanupStreamTerminal(finalText = fullContent) {
      if (activeStream?.turnId !== turnId) return;
      if (wrapper) {
        Neura.messages.removeStatusChip(wrapper, { immediate: true });
        finalizeThoughts({ collapse: true });
      }
      hideIcon(messageDiv);
      activeStream = null;
      if (Neura.agentLog) Neura.agentLog.endSession();
      clearActiveStreamGlobals();
      Neura.messages.toggleSendIcon('send');
      try {
        port.disconnect();
      } catch (e) {}
      if (Neura.voiceMode?.isActive()) Neura.voiceMode.onTurnFinished(finalText);
    }

    port.onMessage.addListener((response) => {
      if (response.type === 'rejoin_state' || response.type === 'no_active_turn') return;
      if (response.turnId && turnId && response.turnId !== turnId) {
        return;
      }

      if (response.type === 'output_steps') {
        if (!wrapper || !isActiveTurn(response)) return;
        renderOutputStepsIfAvailable(response.items || []);
        maybeVoiceChatScroll();
      } else if (response.type === 'reasoning') {
        if (!wrapper || !isActiveTurn(response) || usingOutputSteps) return;
        appendReasoning(response.content || '');
        thoughtFinalized = false;
        if (s.autoScrollEnabled && messageArea) messageArea.scrollTop = messageArea.scrollHeight;
      } else if (response.type === 'chunk') {
        if (!isActiveTurn(response)) return;
        if (reasoningSplitter) {
          const split = reasoningSplitter.feed(response.content || '');
          if (split.reasoning) {
            appendReasoning(split.reasoning);
          }
          if (split.content) {
            if (!thoughtFinalized && !reasoningSplitter.isReasoning()) {
              Neura.messages.finalizeActiveThoughtBlock(wrapper, { collapse: true });
              thoughtFinalized = true;
            }
            fullContent += split.content;
            syncGlobalsFromContent();
            scheduleRender();
          } else if (split.reasoning && s.autoScrollEnabled && messageArea) {
            messageArea.scrollTop = messageArea.scrollHeight;
          }
        } else {
          if (!thoughtFinalized && wrapper) {
            Neura.messages.finalizeActiveThoughtBlock(wrapper, { collapse: true });
            thoughtFinalized = true;
          }
          fullContent += response.content;
          syncGlobalsFromContent();
          scheduleRender();
        }
      } else if (response.type === 'content_reset') {
        if (!isActiveTurn(response)) return;
        if (fullContent.trim() && wrapper) {
          flushReasoningToTimeline();
          thoughtTimeline.push({ kind: 'reasoning', text: fullContent.trim() });
          Neura.messages.appendThoughtContent(wrapper, fullContent);
          Neura.messages.finalizeActiveThoughtBlock(wrapper, { collapse: true });
          thoughtFinalized = true;
        }
        fullContent = '';
        syncGlobalsFromContent();
        if (Neura.reasoningSplitter) {
          reasoningSplitter = Neura.reasoningSplitter.createReasoningStreamSplitter();
        }
        const incoming = response.content || '';
        if (reasoningSplitter && incoming) {
          const split = reasoningSplitter.feed(incoming);
          if (split.reasoning) {
            appendReasoning(split.reasoning);
            thoughtFinalized = false;
          }
          if (split.content) fullContent = split.content;
        } else {
          fullContent = incoming;
        }
        syncGlobalsFromContent();
        scheduleRender();
      } else if (response.type === 'status') {
        if (!wrapper || !isActiveTurn(response)) return;
        if (response.hidden) return;
        Neura.messages.upsertStatusChip(wrapper, {
          description: response.description,
          done: response.done,
          hidden: response.hidden,
        });
        if (response.done && !response.hidden) {
          setTimeout(() => Neura.messages.removeStatusChip(wrapper), 600);
        }
      } else if (response.type === 'sources') {
        if (!wrapper || !isActiveTurn(response)) return;
        Neura.messages.appendSourcesBlock(wrapper, response.items || []);
      } else if (response.type === 'files') {
        if (!isActiveTurn(response)) return;
        const items = response.items || [];
        mergeCollectedFiles(items);
        if (wrapper) Neura.messages.appendFilesBlock(wrapper, items);
      } else if (response.type === 'actions') {
        if (!wrapper || !isActiveTurn(response)) return;
        Neura.messages.appendActionsBar(wrapper, response.items || []);
      } else if (response.type === 'citation') {
        console.debug('Neura: citation event', response.data);
      } else if (response.type === 'function_call') {
        if (!isActiveTurn(response)) return;
        if (usingOutputSteps) return;
        if (wrapper && response.name) {
          flushReasoningToTimeline();
          pushToolToTimeline(response.name, response.callId || response.name);
          Neura.messages.finalizeActiveThoughtBlock(wrapper, { collapse: true });
          thoughtFinalized = true;
          const exploredEl = Neura.messages.appendExploredTool(
            wrapper,
            response.name,
            response.callId || response.name,
          );
          Neura.messages.reorderExploredBeforeLastThought(wrapper, exploredEl);
          if (s.autoScrollEnabled && messageArea) messageArea.scrollTop = messageArea.scrollHeight;
        }
      } else if (response.type === 'function_call_output') {
        if (!wrapper || !isActiveTurn(response)) return;
        if (usingOutputSteps) return;
        Neura.messages.upsertToolResultBlock(wrapper, {
          callId: response.callId,
          status: 'done',
          output: response.output,
        });
        if (s.autoScrollEnabled && messageArea) messageArea.scrollTop = messageArea.scrollHeight;
      } else if (response.type === 'code_interpreter') {
        if (!wrapper || !isActiveTurn(response)) return;
        if (!thoughtFinalized) {
          Neura.messages.finalizeActiveThoughtBlock(wrapper, { collapse: true });
          thoughtFinalized = true;
        }
        Neura.messages.appendCodeInterpreterBlock(wrapper, {
          code: response.code,
          language: response.language,
          output: response.output,
        });
        hideIcon(messageDiv);
        if (s.autoScrollEnabled && messageArea) messageArea.scrollTop = messageArea.scrollHeight;
      } else if (response.type === 'usage') {
        if (!wrapper || !isActiveTurn(response)) return;
        Neura.messages.appendUsageFooter(wrapper, response.data);
      } else if (response.type === 'stream_error') {
        if (!isActiveTurn(response)) return;
        Neura.messages.showStreamErrorBanner(response.message || Neura.i18n.t('streamErrorGeneric'));
      } else if (response.type === 'model_selected') {
        console.debug('Neura: model selected', response.modelId);
      } else if (response.type === 'chat_title') {
        if (Neura.chatSidebar) Neura.chatSidebar.updateChatTitle(response.chatId, response.title);
      } else if (response.type === 'chat_active') {
        if (Neura.chatSidebar) Neura.chatSidebar.setGenerating(response.chatId, !!response.active);
      } else if (response.type === 'agent:iteration') {
        if (!ctx.agentMode || !isActiveTurn(response)) return;
        if (Neura.agentLog) Neura.agentLog.setIteration(response.iteration ?? 0);
      } else if (response.type === 'agent:call_start') {
        if (!ctx.agentMode || !isActiveTurn(response)) return;
        if (Neura.agentLog) Neura.agentLog.onCallStart(response.name || 'tool');
      } else if (response.type === 'agent:call_end') {
        if (!ctx.agentMode || !isActiveTurn(response)) return;
        if (Neura.agentLog) Neura.agentLog.onCallEnd(response.name || 'tool');
      } else if (response.type === 'agent:confirm') {
        if (!ctx.agentMode || !isActiveTurn(response)) return;
        if (Neura.agentLog) Neura.agentLog.showConfirmModal(response, () => {});
      } else if (response.type === 'vision:screenshot') {
        if (!isActiveTurn(response)) return;
        if (response.attachment && ctx.userMessageDiv && Neura.messages.appendSingleUserAttachment) {
          Neura.messages.appendSingleUserAttachment(ctx.userMessageDiv, response.attachment);
        }
        // The user message was already persisted locally before the
        // screenshot finished uploading — fold it in now so it survives a
        // chat switch or reload the same way composer attachments do.
        if (response.attachment && ctx.chatId && ctx.userMessageId) {
          Neura.localChats
            .appendFileToMessage(ctx.chatId, ctx.userMessageId, response.attachment)
            .catch((e) => console.warn('[Neura] failed to persist screenshot attachment locally', e));
        }
      } else if (response.type === 'agent:image') {
        if (!isActiveTurn(response)) return;
        if (response.dataUrl) {
          fullContent += `\n![](${response.dataUrl})\n`;
          syncGlobalsFromContent();
          scheduleRender();
        }
      } else if (response.type === 'complete') {
        if (!isActiveTurn({ turnId })) return;
        if (reasoningSplitter) {
          const tail = reasoningSplitter.flush();
          if (tail.reasoning && wrapper) appendReasoning(tail.reasoning);
          if (tail.content) fullContent += tail.content;
        }
        const serverContent =
          response.data?.message?.content ||
          (typeof response.data?.content === 'string' ? response.data.content : '');
        if (!fullContent.trim() && serverContent) fullContent = serverContent;

        const rawFinal = fullContent || serverContent || '';
        let partitionedThought = '';
        if (rawFinal && Neura.contentPartition?.partitionOwUiContent) {
          const parts = Neura.contentPartition.partitionOwUiContent(rawFinal);
          partitionedThought = parts.thought || '';
          fullContent = parts.content || fullContent;
        }
        const thoughtFromDone = resolveThoughtFromDone(partitionedThought, response.reasoning);
        if (
          !renderOutputStepsIfAvailable(response.outputItems || []) &&
          wrapper &&
          thoughtFromDone &&
          Neura.messages.rebuildPartitionedThoughtUi
        ) {
          Neura.messages.rebuildPartitionedThoughtUi(wrapper, thoughtFromDone);
          thoughtFinalized = true;
        } else if (
          !usingOutputSteps &&
          wrapper &&
          thoughtFromDone &&
          Neura.messages.renderPartitionedThoughtUi
        ) {
          Neura.messages.renderPartitionedThoughtUi(wrapper, thoughtFromDone);
          thoughtFinalized = true;
        }

        if (wrapper) {
          Neura.messages.removeStatusChip(wrapper, { immediate: true });
          if (!usingOutputSteps) finalizeThoughts({ collapse: true });
          if (Neura.messages.dedupeThoughtBlocks) Neura.messages.dedupeThoughtBlocks(wrapper);
          thoughtFinalized = true;
        }
        hideIcon(messageDiv);
        if (fullContent.trim()) {
          syncGlobalsFromContent();
          applyRender();
        }
        const toSave = fullContent.trim() || String(serverContent || '').trim();
        Neura.session.clearAssistantDraft();
        Neura.messages.clearStreamErrorBanner();
        if (toSave) {
          attachAssistantCopyButton(messageDiv, toSave);
          saveAssistantMessage(toSave);
        }
        cleanupStreamTerminal(toSave);
      } else if (response.type === 'done') {
        if (!isActiveTurn(response)) return;
        if (reasoningSplitter) {
          const tail = reasoningSplitter.flush();
          if (tail.reasoning && wrapper) {
            appendReasoning(tail.reasoning);
            thoughtFinalized = false;
          }
          if (tail.content) {
            fullContent += tail.content;
          }
        }

        const rawFinal = response.content || fullContent || '';
        let partitionedThought = '';
        if (rawFinal && Neura.contentPartition?.partitionOwUiContent) {
          const parts = Neura.contentPartition.partitionOwUiContent(rawFinal);
          partitionedThought = parts.thought || '';
          fullContent = parts.content || '';
          if (!fullContent.trim() && rawFinal.trim()) {
            fullContent = rawFinal.trim();
          }
        }

        const thoughtFromDone = resolveThoughtFromDone(partitionedThought, response.reasoning);
        if (
          !renderOutputStepsIfAvailable(response.outputItems || []) &&
          wrapper &&
          thoughtFromDone &&
          Neura.messages.rebuildPartitionedThoughtUi
        ) {
          Neura.messages.rebuildPartitionedThoughtUi(wrapper, thoughtFromDone);
          thoughtFinalized = true;
        } else if (
          !usingOutputSteps &&
          wrapper &&
          thoughtFromDone &&
          Neura.messages.renderPartitionedThoughtUi
        ) {
          Neura.messages.renderPartitionedThoughtUi(wrapper, thoughtFromDone);
          thoughtFinalized = true;
        }

        if (wrapper) {
          Neura.messages.removeStatusChip(wrapper, { immediate: true });
          if (!usingOutputSteps) finalizeThoughts({ collapse: true });
          if (Neura.messages.dedupeThoughtBlocks) Neura.messages.dedupeThoughtBlocks(wrapper);
          thoughtFinalized = true;
        }
        // Safety: finalize any orphaned "Sto pensando…" bubbles from a raced rejoin.
        try {
          const area = Neura.shadow && Neura.shadow.$('message-area');
          if (area) {
            area.querySelectorAll('.neura-thought-block.is-active').forEach((block) => {
              const wrap = block.closest('.message-content-wrapper');
              if (wrap && Neura.messages.finalizeActiveThoughtBlock) {
                Neura.messages.finalizeActiveThoughtBlock(wrap, { collapse: true });
              }
            });
          }
        } catch (e) {}
        hideIcon(messageDiv);

        if (!fullContent && response.content && !Neura.contentPartition?.partitionOwUiContent) {
          fullContent = response.content;
        }
        if (fullContent) {
          syncGlobalsFromContent();
          applyRender();
        }

        const toSave = fullContent;
        Neura.session.clearAssistantDraft();
        Neura.messages.clearStreamErrorBanner();
        if (toSave) {
          attachAssistantCopyButton(messageDiv, toSave);
          saveAssistantMessage(toSave);
        } else {
          hideIcon(messageDiv);
        }
        cleanupStreamTerminal();
      } else if (response.type === 'aborted') {
        if (!isActiveTurn(response)) return;
        const wasAgent = !!ctx.agentMode;
        if (wrapper) {
          Neura.messages.removeStatusChip(wrapper, { immediate: true });
          finalizeThoughts({ collapse: true });
          thoughtFinalized = true;
        }
        hideIcon(messageDiv);

        if (wasAgent) {
          fullContent = fullContent && fullContent.trim()
            ? `${fullContent}\n\n---\n\n${Neura.i18n.t('agentStopped')}`
            : Neura.i18n.t('agentStopped');
        } else {
          fullContent = fullContent && fullContent.trim()
            ? `${fullContent}\n\n---\n\n${Neura.i18n.t('generationStopped')}`
            : Neura.i18n.t('generationStopped');
        }

        syncGlobalsFromContent();
        applyRender();
        Neura.session.clearAssistantDraft();
        attachAssistantCopyButton(messageDiv, fullContent);
        saveAssistantMessage(fullContent);
        cleanupStreamTerminal('');
      } else if (response.type === 'error') {
        if (response?.turnId && turnId && response.turnId !== turnId) return;
        if (wrapper) {
          Neura.messages.removeStatusChip(wrapper, { immediate: true });
          Neura.messages.clearThoughtSequence(wrapper);
          thoughtFinalized = true;
        }
        if (contentDiv) {
          contentDiv.textContent = `${Neura.i18n.t('errorPrefix')}: ${response.error}`;
        }
        Neura.session.clearAssistantDraft();
        cleanupStreamTerminal('');
      }
    });
  }

  function sendPayloadToBackground(payload, action, userMessageEl, chatId, sendOpts = {}) {
    if (action !== 'sendMessageToOpenWebUI') return false;

    abortActiveStream();

    payload.agentMode = syncAgentModeFromUi();

    const s = st();
    const turnId = payload.turnId || makeTurnId();
    payload.turnId = turnId;
    payload.activeChatId = chatId;

    const port = chrome.runtime.connect({ name: 'streaming' });

    const payloadSize = JSON.stringify(payload).length;
    const MAX_PAYLOAD_SIZE = 100000;
    // Cap page scrape sent for OWUI file upload (background truncates again at 50k).
    if (payload.pageContext && typeof payload.pageContext.text === 'string') {
      const MAX_PAGE = 50000;
      if (payload.pageContext.text.length > MAX_PAGE) {
        payload.pageContext = {
          ...payload.pageContext,
          text:
            payload.pageContext.text.substring(0, MAX_PAGE) +
            (Neura.i18n.t('payloadTruncated') || '\n\n[...truncated...]'),
        };
      }
    }
    if (payloadSize > MAX_PAYLOAD_SIZE && payload.pageContext && payload.pageContext.text) {
      const maxTextLength = Math.max(
        10000,
        MAX_PAYLOAD_SIZE - (payloadSize - payload.pageContext.text.length),
      );
      payload.pageContext.text =
        payload.pageContext.text.substring(0, maxTextLength) + Neura.i18n.t('payloadTruncated');
    }

    // Shrink legacy type:text attachment bodies if the port payload is still huge.
    if (
      Array.isArray(payload.attachments) &&
      payload.attachments.length > 0 &&
      Neura.fileAttachments?.truncateForTransport
    ) {
      let size = JSON.stringify(payload).length;
      if (size > MAX_PAYLOAD_SIZE) {
        payload.attachments = Neura.fileAttachments.truncateForTransport(
          payload.attachments,
          Math.max(20000, MAX_PAYLOAD_SIZE - (size - JSON.stringify(payload.attachments).length)),
        );
      }
    }

    const ctx = buildAssistantBubble('');
    if (!ctx) {
      if (typeof sendOpts.onFailure === 'function') sendOpts.onFailure(new Error('No message area'));
      return false;
    }

    if (payload.agentMode) {
      s.agentRunning = true;
      if (Neura.agentLog) Neura.agentLog.beginSession(ctx.contentWrapper, port);
    } else {
      s.agentRunning = false;
      if (Neura.agentLog) Neura.agentLog.endSession();
    }

    activeStream = {
      turnId,
      chatId,
      port,
      contentDiv: ctx.contentDiv,
      contentWrapper: ctx.contentWrapper,
      messageDiv: ctx.messageDiv,
      agentMode: !!payload.agentMode,
    };

    installPortListener(port, {
      ...ctx,
      turnId,
      chatId,
      agentMode: !!payload.agentMode,
      initialContent: '',
      userMessageContainer: userMessageEl?.container || null,
      userMessageDiv: userMessageEl?.div || null,
      userMessageId: payload.userMessageId || null,
    });

    try {
      port.postMessage(payload);
      Neura.messages.toggleSendIcon('loading');
      Neura.messages.clearStreamErrorBanner();
      if (typeof sendOpts.onSuccess === 'function') sendOpts.onSuccess();
      return true;
    } catch (e) {
      Neura.messages.toggleSendIcon('send');
      if (typeof sendOpts.onFailure === 'function') sendOpts.onFailure(e);
      return false;
    }
  }

  async function sendMessageToBackground(action, message, extra = {}) {
    if (action !== 'sendMessageToOpenWebUI') return;
    const sessionKey = Neura.session.getSessionKey();

    // Conduit: snapshot context attachments first, fold onto user message, clear only after send.
    let attachmentSnapshot = [];
    if (Neura.fileAttachments) {
      attachmentSnapshot = Neura.fileAttachments.getPendingAttachments();
    } else if (Neura.knowledgeMention) {
      attachmentSnapshot = Neura.knowledgeMention.getPendingAttachments();
    }
    const displayFiles =
      Neura.fileAttachments && typeof Neura.fileAttachments.toDisplayFiles === 'function'
        ? Neura.fileAttachments.toDisplayFiles(attachmentSnapshot)
        : attachmentSnapshot;

    if (
      displayFiles.length > 0 &&
      extra.userMessageEl?.div &&
      Neura.messages.appendUserAttachmentsBlock
    ) {
      Neura.messages.appendUserAttachmentsBlock(extra.userMessageEl.div, displayFiles);
    }

    // Build conversation from local cache (synced with OWUI server in background).
    const chatId = await Neura.session.ensureActiveChatId();
    const priorChat = await Neura.localChats.get(chatId);
    const conversationHistory = Neura.localChats.toConversationHistory(priorChat);
    const remoteHistory = Neura.localChats.toRemoteHistory(priorChat);
    const userMsg = await Neura.localChats.addMessage(chatId, {
      role: 'user',
      content: message,
      files: displayFiles.length > 0 ? displayFiles : undefined,
    });

    if (userMsg && extra.userMessageEl) {
      if (extra.userMessageEl.container) extra.userMessageEl.container.dataset.messageId = userMsg.id;
      if (extra.userMessageEl.div) extra.userMessageEl.div.dataset.messageId = userMsg.id;
    }

    const updatedChat = await Neura.localChats.get(chatId);
    if (updatedChat) Neura.session.setActiveChatId(chatId, updatedChat.title);
    // Bind this chat to the exact page URL so reopening the extension here
    // later (even days later) resumes the same conversation.
    if (Neura.session.rememberChatForCurrentUrl) Neura.session.rememberChatForCurrentUrl(chatId);
    if (Neura.chatSidebar) Neura.chatSidebar.refresh();

    const payload = {
      action,
      message,
      conversationHistory,
      remoteHistory,
      userMessageId: userMsg?.id || null,
      activeChatId: chatId,
      chatTitle: updatedChat?.title || priorChat?.title || Neura.i18n.t('newChat'),
      turnId: makeTurnId(),
      agentMode: syncAgentModeFromUi(),
      sessionKey,
      originalUrl: window.location.href,
    };

    const contextToggleBtn = Neura.shadow.$('context-toggle-btn');
    const screenshotToggleBtn = Neura.shadow.$('screenshot-toggle-btn');
    const knowledgeToggleBtn = Neura.shadow.$('knowledge-toggle-btn');
    const webSearchToggle = Neura.shadow.$('web-search-toggle-btn');
    const imageGenToggle = Neura.shadow.$('image-gen-toggle-btn');
    const codeInterpToggle = Neura.shadow.$('code-interpreter-toggle-btn');

    if (contextToggleBtn && contextToggleBtn.dataset.active === 'true') {
      try {
        const t0 = Date.now();
        payload.pageContext = await Neura.pageContext.getPageContext();
        Neura.debug?.dlog?.('page-context', 'scraped for send', {
          elapsedMs: Date.now() - t0,
          title: payload.pageContext?.title || null,
          url: payload.pageContext?.url || null,
          textLen: payload.pageContext?.text ? String(payload.pageContext.text).length : 0,
          descriptionLen: payload.pageContext?.description
            ? String(payload.pageContext.description).length
            : 0,
        });
      } catch (e) {
        Neura.debug?.dwarn?.('page-context', 'scrape failed', e);
        payload.pageContext = {};
      }
    } else {
      Neura.debug?.dlog?.('page-context', 'context toggle off; no page scrape');
      payload.pageContext = {};
    }

    payload.visionScreenshots = screenshotToggleBtn?.dataset.active === 'true';

    if (knowledgeToggleBtn && knowledgeToggleBtn.dataset.active === 'true') {
      payload.useKnowledge = true;
    }

    payload.features = {
      web_search: webSearchToggle?.dataset.active === 'true',
      image_generation: imageGenToggle?.dataset.active === 'true',
      code_interpreter: codeInterpToggle?.dataset.active === 'true',
      memory: false,
      voice: false,
    };
    payload.selectedToolIds = Neura.state.selectedToolIds || [];
    payload.enabledKnowledgeIds = Neura.state.enabledKnowledgeIds || [];

    if (attachmentSnapshot.length > 0) {
      payload.attachments = attachmentSnapshot;
    }

    Neura.debug?.dlog?.('chat', 'sending payload to background', {
      turnId: payload.turnId,
      chatId,
      agentMode: !!payload.agentMode,
      visionScreenshots: !!payload.visionScreenshots,
      features: payload.features,
      attachmentCount: attachmentSnapshot.length,
      attachments: attachmentSnapshot.map((a) => ({
        id: a?.id,
        type: a?.type,
        name: a?.name,
        context: a?.context,
        sourceUrl: a?.sourceUrl,
      })),
      pageContext: payload.pageContext
        ? {
            title: payload.pageContext.title || null,
            url: payload.pageContext.url || null,
            textLen: payload.pageContext.text ? String(payload.pageContext.text).length : 0,
          }
        : null,
      messagePreview: String(message || '').slice(0, 80),
    });

    // Clear composer only after attachments are on the user bubble + local message
    // (Conduit clears after folding into userMessage.files). Restore on postMessage failure.
    if (Neura.fileAttachments) {
      Neura.fileAttachments.clearPendingAttachments();
    } else if (Neura.knowledgeMention) {
      Neura.knowledgeMention.clearPendingAttachments();
    }

    sendPayloadToBackground(payload, action, extra.userMessageEl, chatId, {
      onFailure: () => {
        if (Neura.fileAttachments && attachmentSnapshot.length > 0) {
          Neura.fileAttachments.restoreAttachments(attachmentSnapshot);
        }
      },
    });
  }

  Neura.streaming = {
    sendMessageToBackground,
    buildAssistantBubble,
    installPortListener,
    abortActiveStream,
    isStreamActive() {
      return activeStream != null;
    },

    async sendUserMessage() {
      const messageInput = Neura.shadow.$('message-input');
      if (!messageInput) return;
      if (Neura.fileAttachments && Neura.fileAttachments.hasUploading()) {
        return;
      }
      const userMessage = messageInput.value.trim();
      const pendingAtts =
        Neura.fileAttachments && typeof Neura.fileAttachments.getPendingAttachments === 'function'
          ? Neura.fileAttachments.getPendingAttachments()
          : [];

      if (!userMessage && pendingAtts.length === 0) return;
      // Attachment-only sends show no placeholder text, matching OWUI (the
      // image/file itself is the message).
      const displayText = userMessage;
      const displayFiles =
        Neura.fileAttachments && typeof Neura.fileAttachments.toDisplayFiles === 'function'
          ? Neura.fileAttachments.toDisplayFiles(pendingAtts)
          : [];
      const userMessageContainer = Neura.messages.addMessageToChat('user', displayText, {
        files: displayFiles,
      });
      maybeVoiceChatScroll();
      const userMessageDiv = userMessageContainer?.querySelector('.user-message') || null;
      Neura.messages.toggleSendIcon('loading');
      Neura.messages.resetInput();
      await sendMessageToBackground('sendMessageToOpenWebUI', userMessage || ' ', {
        userMessageEl: { container: userMessageContainer, div: userMessageDiv },
      });
    },

    handleSendButtonClick(sendIcon) {
      if (sendIcon.classList.contains('loading')) {
        abortStreamingFromUi();
      } else {
        Neura.streaming.sendUserMessage();
      }
    },
  };

  // Open WebUI keeps working on a turn after the answer itself is complete
  // (outlet filters, title, tags, follow-up suggestions). Those events reach the
  // background on its persistent socket consumer, but by then this turn's
  // streaming port is usually closed, so they are delivered as runtime messages.
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.action === 'chat_follow_ups') {
        // The extension only renders one chat at a time, so the most recent
        // assistant bubble in the DOM is always the right drop target — no
        // per-chat routing needed beyond that.
        const messageArea = Neura.shadow && Neura.shadow.$('message-area');
        if (!messageArea) return false;
        const bubbles = messageArea.querySelectorAll('.assistant-message');
        const lastBubble = bubbles[bubbles.length - 1];
        const wrapper = lastBubble?.querySelector('.message-content-wrapper');
        if (wrapper && Neura.messages?.appendFollowUpsBlock) {
          Neura.messages.appendFollowUpsBlock(wrapper, msg.items || []);
        }
        return false;
      }

      if (msg?.action === 'chat_active') {
        if (Neura.chatSidebar) Neura.chatSidebar.setGenerating(msg.chatId, !!msg.active);
        return false;
      }

      return false;
    });
  }
})(window.Neura);
