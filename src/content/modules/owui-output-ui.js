(function (Neura) {
  const GROUPABLE_TYPES = new Set([
    'reasoning',
    'function_call',
    'open_webui:code_interpreter',
    'web_search_call',
    'file_search_call',
    'computer_call',
  ]);

  function getTextFromParts(parts) {
    if (!Array.isArray(parts)) return '';
    return parts
      .map((part) => {
        if (part?.text == null) return '';
        return typeof part.text === 'string' ? part.text : String(part.text);
      })
      .join('');
  }

  function getReasoningText(item) {
    const summary = Array.isArray(item?.summary) && item.summary.length ? item.summary : null;
    return getTextFromParts(summary ?? item?.content ?? []);
  }

  function getToolResultText(item) {
    if (!item) return '';
    return (item.output ?? [])
      .filter((part) => part?.type !== 'input_image')
      .map((part) => {
        if (part?.text == null) return '';
        return typeof part.text === 'string' ? part.text : String(part.text);
      })
      .join('');
  }

  function isDoneStatus(status) {
    return status === 'completed' || status === 'failed' || status === 'incomplete';
  }

  function formatReasoningBody(text) {
    return String(text || '')
      .split('\n')
      .map((line) => line.replace(/^>\s?/, '').trim())
      .filter(Boolean)
      .join('\n');
  }

  /**
   * `ordinal` is the item's position in `output`, which Open WebUI only ever
   * appends to during a turn. It therefore identifies the same step across the
   * successive snapshots of one message, which is what lets the renderer update
   * a panel in place instead of rebuilding it (and losing its open/closed state).
   */
  function buildDetailToken(item, isLastItem, toolOutputByCallId, ordinal) {
    if (!item || typeof item !== 'object') return null;
    if (item.type === 'function_call') {
      const callId = item.call_id ?? '';
      const resultItem = toolOutputByCallId[callId];
      const isDone = isDoneStatus(item.status) || !!resultItem;
      return {
        kind: 'tool',
        key: `tool:${callId || item.name || ''}:${ordinal}`,
        name: item.name ?? '',
        callId,
        isDone,
        arguments: item.arguments ?? '',
        output: getToolResultText(resultItem),
      };
    }
    if (item.type === 'reasoning') {
      const text = formatReasoningBody(getReasoningText(item));
      const duration = item.duration ?? '';
      const isDone = isDoneStatus(item.status) || item.duration != null || !isLastItem;
      // Completed empty rows only produce "Thought for less than a second" spam.
      // Keep a single in-progress placeholder so "Thinking…" can still appear.
      if (!text.trim() && isDone) return null;
      return {
        kind: 'reasoning',
        key: `reasoning:${ordinal}`,
        isDone,
        duration: Number(duration) || 0,
        text,
      };
    }
    if (item.type === 'open_webui:code_interpreter') {
      const duration = item.duration ?? '';
      const isDone = isDoneStatus(item.status) || item.duration != null || !isLastItem;
      return {
        kind: 'code',
        key: `code:${ordinal}`,
        isDone,
        duration: Number(duration) || 0,
        code: item.code ?? '',
        output: item.output ?? '',
      };
    }
    return null;
  }

  /**
   * Open WebUI often appends a new `reasoning` item per model tick. Showing each
   * as its own panel produces dozens of "Thought for less than a second" rows.
   * Consecutive reasoning tokens become one panel: texts joined, durations summed.
   */
  function coalesceConsecutiveReasoning(tokens) {
    const out = [];
    for (const token of tokens) {
      const prev = out[out.length - 1];
      if (token.kind === 'reasoning' && prev?.kind === 'reasoning') {
        const parts = [prev.text, token.text].map((t) => String(t || '').trim()).filter(Boolean);
        prev.text = parts.join('\n\n');
        prev.duration = (Number(prev.duration) || 0) + (Number(token.duration) || 0);
        prev.isDone = !!prev.isDone && !!token.isDone;
        continue;
      }
      out.push({ ...token });
    }
    return out;
  }

  function buildDisplaySteps(output) {
    if (!Array.isArray(output) || output.length === 0) return [];

    const toolOutputByCallId = {};
    for (const item of output) {
      if (item?.type === 'function_call_output' && item.call_id) {
        toolOutputByCallId[item.call_id] = item;
      }
    }

    const steps = [];
    let group = [];

    const flushGroup = () => {
      if (group.length === 0) return;
      const tokens = coalesceConsecutiveReasoning(group);
      group = [];
      if (tokens.length === 0) return;
      if (tokens.length === 1) {
        steps.push({ type: 'single', key: tokens[0].key, token: tokens[0] });
      } else {
        // Keyed on its first member: a group keeps growing as the server appends
        // steps, so its identity must not depend on how many it holds.
        steps.push({ type: 'group', key: `group:${tokens[0].key}`, tokens });
      }
    };

    output.forEach((item, index) => {
      if (item?.type === 'function_call_output') return;
      if (item?.type && GROUPABLE_TYPES.has(item.type)) {
        const token = buildDetailToken(item, index === output.length - 1, toolOutputByCallId, index);
        if (token) group.push(token);
        return;
      }
      flushGroup();
    });

    flushGroup();
    return steps;
  }

  function insertBeforeContent(wrapperEl, el) {
    if (!wrapperEl || !el) return;
    const contentDiv = wrapperEl.querySelector('.message-content');
    if (contentDiv) wrapperEl.insertBefore(el, contentDiv);
    else wrapperEl.appendChild(el);
  }

  function createStepIcon(isDone) {
    const span = document.createElement('span');
    span.className = `neura-step-check ${isDone ? 'is-done' : 'is-pending'}`;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function updateStepIcon(summaryEl, isDone) {
    const icon = summaryEl?.querySelector('.neura-step-check');
    if (!icon) return;
    icon.classList.toggle('is-done', !!isDone);
    icon.classList.toggle('is-pending', !isDone);
  }

  function createChevron() {
    const span = document.createElement('span');
    span.className = 'neura-step-chevron';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function exploredSummary(tokens) {
    const nameCounts = {};
    for (const token of tokens) {
      if (token.kind !== 'tool') continue;
      const name = token.name || 'tool';
      nameCounts[name] = (nameCounts[name] || 0) + 1;
    }
    const parts = Object.entries(nameCounts).map(([name, count]) =>
      count > 1 ? `${count} ${name}` : name,
    );
    return parts.join(', ');
  }

  function hasPending(tokens) {
    return tokens.some((token) => !token.isDone);
  }

  /**
   * Open WebUI re-sends the whole `output` array on every frame, so a panel is
   * re-rendered many times while the answer is being produced. Opening and
   * closing is the reader's decision, so once they act on a panel the renderer
   * stops driving its state: without this, every incoming frame would snap the
   * panel back to whatever the automatic rule says.
   */
  function markUserIntent(stateEl, triggerEl) {
    if (!stateEl || !triggerEl || triggerEl._neuraIntentBound) return;
    triggerEl._neuraIntentBound = true;
    triggerEl.addEventListener('click', () => {
      stateEl.dataset.userToggled = 'true';
    });
  }

  function userDecided(el) {
    return el?.dataset?.userToggled === 'true';
  }

  function setText(el, text) {
    if (!el) return;
    const next = String(text ?? '');
    if (el.textContent !== next) el.textContent = next;
  }

  function ensureBody(block, tagName, className) {
    let body = block.querySelector(`.${className}`);
    if (!body) {
      body = document.createElement(tagName);
      body.className = className;
      block.appendChild(body);
    }
    return body;
  }

  function toolBodyText(token) {
    const parts = [];
    if (token.arguments) {
      const argsText =
        typeof token.arguments === 'string' ? token.arguments : JSON.stringify(token.arguments, null, 2);
      if (argsText.trim()) parts.push(`${Neura.i18n.t('toolInput')}\n${argsText.trim()}`);
    }
    if (token.output && String(token.output).trim()) {
      parts.push(`${Neura.i18n.t('toolOutput')}\n${String(token.output).trim()}`);
    }
    return parts.join('\n\n');
  }

  function reasoningLabel(token) {
    if (!token.isDone) return Neura.i18n.t('thoughtActive');
    const secs = token.duration || 0;
    if (secs < 1) return Neura.i18n.t('thoughtDoneSubSecond');
    if (secs === 1) return Neura.i18n.t('thoughtDoneOne');
    return Neura.i18n.t('thoughtDoneMany', secs);
  }

  function createDetailsShell(className, summaryClassName, labelClassName, withIcon) {
    const block = document.createElement('details');
    block.className = className;
    block.open = false;

    const summary = document.createElement('summary');
    summary.className = summaryClassName;
    if (withIcon) summary.appendChild(createStepIcon(false));

    const label = document.createElement('span');
    label.className = labelClassName;
    summary.appendChild(label);
    summary.appendChild(createChevron());
    block.appendChild(summary);

    markUserIntent(block, summary);
    return block;
  }

  function createToolStep() {
    return createDetailsShell(
      'neura-tool-result-block',
      'neura-tool-result-summary',
      'neura-tool-result-label',
      true,
    );
  }

  function updateToolStep(block, token) {
    block.dataset.callId = token.callId || token.name || '';
    block.dataset.toolName = token.name || '';
    block.classList.toggle('is-done', !!token.isDone);
    block.classList.toggle('is-running', !token.isDone);

    const summary = block.querySelector('.neura-tool-result-summary');
    updateStepIcon(summary, token.isDone);
    setText(
      summary?.querySelector('.neura-tool-result-label'),
      token.isDone
        ? Neura.i18n.t('viewToolResult', token.name || Neura.i18n.t('ellipsis'))
        : Neura.i18n.t('toolRunning', token.name || Neura.i18n.t('ellipsis')),
    );

    const bodyText = toolBodyText(token);
    const existingBody = block.querySelector('.neura-tool-result-body');
    if (bodyText) {
      setText(ensureBody(block, 'pre', 'neura-tool-result-body'), bodyText);
    } else if (existingBody) {
      existingBody.remove();
    }
  }

  function createReasoningStep() {
    return createDetailsShell(
      'neura-thought-block has-content',
      'neura-thought-summary',
      'neura-thought-label',
      false,
    );
  }

  function updateReasoningStep(block, token) {
    if (block._startedAt == null) {
      block._startedAt = Date.now() - (token.duration || 0) * 1000;
    }
    block._reasoningText = token.text;
    const hasContent = !!String(token.text || '').trim();
    block.classList.toggle('has-content', hasContent);
    setText(block.querySelector('.neura-thought-label'), reasoningLabel(token));
    if (hasContent) {
      setText(
        ensureBody(block, 'div', 'neura-thought-body'),
        Neura.markdown.normalizeThoughtText(token.text),
      );
    } else {
      const body = block.querySelector('.neura-thought-body');
      if (body) body.textContent = '';
    }
  }

  function createCodeStep() {
    return createDetailsShell(
      'neura-tool-result-block is-done',
      'neura-tool-result-summary',
      'neura-tool-result-label',
      true,
    );
  }

  function updateCodeStep(block, token) {
    const summary = block.querySelector('.neura-tool-result-summary');
    updateStepIcon(summary, token.isDone);
    setText(
      summary?.querySelector('.neura-tool-result-label'),
      token.isDone ? Neura.i18n.t('codeAnalyzed') : Neura.i18n.t('codeAnalyzing'),
    );
    setText(
      ensureBody(block, 'pre', 'neura-tool-result-body'),
      token.code || String(token.output || ''),
    );
  }

  /**
   * @returns {HTMLElement|null} null when the step has nothing to show yet
   */
  function syncToken(existingEl, token) {
    if (token.kind === 'reasoning' && !token.text?.trim() && token.isDone) return null;

    let el = existingEl;
    if (!el) {
      if (token.kind === 'tool') el = createToolStep();
      else if (token.kind === 'reasoning') el = createReasoningStep();
      else if (token.kind === 'code') el = createCodeStep();
      else return null;
      el.dataset.stepKey = token.key;
    }

    if (token.kind === 'tool') updateToolStep(el, token);
    else if (token.kind === 'reasoning') updateReasoningStep(el, token);
    else if (token.kind === 'code') updateCodeStep(el, token);

    return el;
  }

  function childByKey(containerEl, key) {
    for (const child of containerEl.children) {
      if (child.dataset?.stepKey === key) return child;
    }
    return null;
  }

  /**
   * Place `elements` in order inside `containerEl` and drop what is no longer
   * part of the output. Existing nodes are moved, never recreated, so their
   * open/closed state and scroll position survive.
   */
  function reconcileChildren(containerEl, elements) {
    elements.forEach((el, index) => {
      if (containerEl.children[index] !== el) {
        containerEl.insertBefore(el, containerEl.children[index] || null);
      }
    });
    while (containerEl.children.length > elements.length) {
      containerEl.lastElementChild.remove();
    }
  }

  function setGroupOpen(wrap, open) {
    const header = wrap.querySelector('.neura-detail-group-header');
    const body = wrap.querySelector('.neura-detail-group-body');
    if (!header || !body) return;
    body.hidden = !open;
    header.classList.toggle('is-open', open);
    header.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function createDetailGroup(key) {
    const wrap = document.createElement('div');
    wrap.className = 'neura-detail-group';
    wrap.dataset.stepKey = key;

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'neura-detail-group-header';
    header.setAttribute('aria-expanded', 'false');
    header.appendChild(createStepIcon(false));

    const labelWrap = document.createElement('span');
    labelWrap.className = 'neura-detail-group-label';
    const prefix = document.createElement('span');
    prefix.className = 'neura-detail-group-prefix';
    labelWrap.appendChild(prefix);
    const detail = document.createElement('span');
    detail.className = 'neura-detail-group-tools';
    labelWrap.appendChild(detail);
    header.appendChild(labelWrap);
    header.appendChild(createChevron());
    wrap.appendChild(header);

    const body = document.createElement('div');
    body.className = 'neura-detail-group-body';
    body.hidden = true;
    wrap.appendChild(body);

    header.addEventListener('click', () => {
      wrap.dataset.userToggled = 'true';
      setGroupOpen(wrap, !header.classList.contains('is-open'));
    });
    return wrap;
  }

  function updateDetailGroup(wrap, tokens, opts) {
    const pending = hasPending(tokens);
    const header = wrap.querySelector('.neura-detail-group-header');
    updateStepIcon(header, !pending);
    setText(
      header?.querySelector('.neura-detail-group-prefix'),
      pending ? Neura.i18n.t('exploringPrefix') : Neura.i18n.t('exploredPrefix'),
    );
    const toolsText = exploredSummary(tokens);
    setText(header?.querySelector('.neura-detail-group-tools'), toolsText ? ` ${toolsText}` : '');

    const body = wrap.querySelector('.neura-detail-group-body');
    const rendered = [];
    for (const token of tokens) {
      const el = syncToken(childByKey(body, token.key), token);
      if (el) rendered.push(el);
    }
    reconcileChildren(body, rendered);

    // Follow the work while it runs, tidy up when it ends — unless the reader
    // has already expressed a preference for this group.
    if (!userDecided(wrap)) {
      setGroupOpen(wrap, pending && opts.autoOpenWhileRunning !== false);
    }
  }

  /**
   * Panels rendered by the plain streaming path (messages.js) describe the same
   * turn: once the server sends structured `output` steps they are the single
   * source of truth, so the older nodes are dropped one time only.
   */
  function removeLegacySteps(wrapperEl, containerEl) {
    wrapperEl
      .querySelectorAll(
        '.neura-detail-group, .neura-thought-block, .neura-explored-block, .neura-explored-tools, .neura-tool-result-block',
      )
      .forEach((el) => {
        if (!containerEl.contains(el)) el.remove();
      });
  }

  function ensureStepsContainer(wrapperEl) {
    let container = wrapperEl.querySelector('.neura-output-steps');
    if (!container) {
      container = document.createElement('div');
      container.className = 'neura-output-steps';
      insertBeforeContent(wrapperEl, container);
      removeLegacySteps(wrapperEl, container);
    }
    return container;
  }

  function clearOutputSteps(wrapperEl) {
    if (!wrapperEl) return;
    wrapperEl
      .querySelectorAll(
        '.neura-output-steps, .neura-detail-group, .neura-thought-block, .neura-explored-block, .neura-explored-tools, .neura-tool-result-block',
      )
      .forEach((el) => el.remove());
  }

  function renderOutputSteps(wrapperEl, outputItems, opts = {}) {
    if (!wrapperEl) return false;
    const steps = buildDisplaySteps(outputItems);
    if (!steps.length) return false;

    const container = ensureStepsContainer(wrapperEl);
    const rendered = [];

    for (const step of steps) {
      if (step.type === 'group') {
        const wrap = childByKey(container, step.key) || createDetailGroup(step.key);
        updateDetailGroup(wrap, step.tokens, opts);
        rendered.push(wrap);
        continue;
      }
      const el = syncToken(childByKey(container, step.key), step.token);
      if (el) rendered.push(el);
    }

    reconcileChildren(container, rendered);
    return true;
  }

  Neura.owuiOutput = {
    buildDisplaySteps,
    clearOutputSteps,
    renderOutputSteps,
  };
})(window.Neura);
