(function (Neura) {
  function requireAgentMode() {
    if (!Neura.state.agentMode && !Neura.state.agentRunning) {
      throw new Error('agent mode disabled');
    }
  }

  function pickNth(selector, nth = 0) {
    const list = document.querySelectorAll(selector);
    if (!list.length) throw new Error(`no element for selector: ${selector}`);
    const i = Math.min(Math.max(0, nth), list.length - 1);
    return list[i];
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function setNativeInputValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
  }

  function dispatchInputEvents(el, data) {
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: data || null,
      }),
    );
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function dispatchKey(el, key) {
    const codes = { Enter: 13, ArrowDown: 40, ArrowUp: 38, Tab: 9, Escape: 27 };
    const keyCode = codes[key] || 0;
    const opts = {
      key,
      code: key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function dispatchPointerClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    if (typeof el.click === 'function') el.click();
  }

  function isGoogleMapsPage() {
    return /\/\/(www\.)?google\.[a-z.]+\/maps/i.test(window.location.href);
  }

  function isConsentNoiseInput(el) {
    const id = el?.id || '';
    return /^ucc-/i.test(id);
  }

  function pickFillTarget(args) {
    const nth = args.nth ?? 0;
    const list = [...document.querySelectorAll(args.selector)];
    if (!list.length) throw new Error(`no element for selector: ${args.selector}`);
    const filtered = isGoogleMapsPage()
      ? list.filter((el) => !isConsentNoiseInput(el) && isVisible(el))
      : list.filter((el) => isVisible(el));
    const pool = filtered.length ? filtered : list;
    const i = Math.min(Math.max(0, nth), pool.length - 1);
    return pool[i];
  }

  function listMapsInputs() {
    return [...document.querySelectorAll('input, textarea, [contenteditable="true"]')]
      .filter((el) => !isConsentNoiseInput(el))
      .slice(0, 12)
      .map((el, index) => ({
        index,
        tag: el.tagName?.toLowerCase?.() || '',
        id: el.id || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        role: el.getAttribute('role') || '',
        visible: isVisible(el),
        valuePreview: String('value' in el ? el.value : el.textContent || '').slice(0, 80),
      }));
  }

  Neura.agentTools = {
    read_dom_snapshot(args) {
      requireAgentMode();
      const maxLen = args.max_length ?? 12000;
      let root =
        (args.selector && document.querySelector(args.selector)) ||
        document.querySelector('#mw-content-text .mw-parser-output') ||
        document.querySelector('#mw-content-text') ||
        document.querySelector('article .mw-parser-output') ||
        document.querySelector('article') ||
        document.querySelector('[role="main"]') ||
        document.querySelector('main') ||
        document.body;
      if (!root) throw new Error('no root');
      let text = root.innerText || '';
      if (text.length > maxLen) {
        text = `${text.slice(0, maxLen)}\n...(truncated)`;
      }
      const result = {
        title: document.title,
        url: window.location.href,
        text,
      };
      if (isGoogleMapsPage()) {
        result.mapsInputs = listMapsInputs();
        result.pacItems = document.querySelectorAll('.pac-item').length;
      }
      return result;
    },

    query_elements(args) {
      requireAgentMode();
      const limit = Math.min(args.limit ?? 20, 50);
      const nodes = document.querySelectorAll(args.selector);
      const out = [];
      for (let i = 0; i < nodes.length && out.length < limit; i++) {
        const el = nodes[i];
        if (isGoogleMapsPage() && isConsentNoiseInput(el)) continue;
        const tag = el.tagName?.toLowerCase() || 'node';
        const id = el.id || '';
        const role = el.getAttribute('role') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        out.push({
          index: i,
          tag,
          id,
          role,
          ariaLabel,
          placeholder,
          visible: isVisible(el),
          textPreview: t,
        });
      }
      const payload = { count: nodes.length, elements: out };
      if (isGoogleMapsPage() && out.length === 0 && /^input|textarea|\[contenteditable/i.test(args.selector || '')) {
        payload.mapsInputsHint = listMapsInputs();
      }
      return payload;
    },

    get_element_text(args) {
      requireAgentMode();
      const el = pickNth(args.selector, args.nth ?? 0);
      return { text: (el.textContent || '').trim() };
    },

    click_element(args) {
      requireAgentMode();
      const el = pickNth(args.selector, args.nth ?? 0);
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (!isVisible(el)) throw new Error('element not visible');
      dispatchPointerClick(el);
      return { ok: true, message: 'clicked' };
    },

    fill_input(args) {
      requireAgentMode();
      const el = pickFillTarget(args);
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.focus({ preventScroll: true });

      if (el.isContentEditable) {
        const next = args.append ? (el.textContent || '') + args.value : args.value;
        el.textContent = next;
        dispatchInputEvents(el, args.value);
        if (args.press_enter) dispatchKey(el, 'Enter');
        return { ok: true, message: args.press_enter ? 'filled contenteditable + Enter' : 'filled contenteditable' };
      }
      if ('value' in el) {
        const cur = args.append ? String(el.value || '') : '';
        const next = cur + args.value;
        setNativeInputValue(el, next);
        dispatchInputEvents(el, args.value);
        if (args.press_enter) dispatchKey(el, 'Enter');
        return { ok: true, message: args.press_enter ? 'filled input + Enter' : 'filled input' };
      }
      throw new Error('element is not fillable');
    },

    press_key(args) {
      requireAgentMode();
      const key = String(args.key || 'Enter');
      const allowed = new Set(['Enter', 'ArrowDown', 'ArrowUp', 'Tab', 'Escape']);
      if (!allowed.has(key)) throw new Error(`unsupported key: ${key}`);
      let target = document.activeElement || document.body;
      if (args.selector) {
        target = pickNth(args.selector, args.nth ?? 0);
        target.focus({ preventScroll: false });
      }
      dispatchKey(target, key);
      return { ok: true, message: `pressed ${key}` };
    },

    focus_element(args) {
      requireAgentMode();
      const el = pickNth(args.selector, args.nth ?? 0);
      el.focus({ preventScroll: false });
      return { ok: true };
    },

    scroll_to(args) {
      requireAgentMode();
      if (args.selector) {
        const el = document.querySelector(args.selector);
        if (!el) throw new Error('selector not found');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { ok: true };
      }
      window.scrollTo({ top: args.y ?? 0, behavior: 'smooth' });
      return { ok: true };
    },

    submit_form(args) {
      requireAgentMode();
      const form = document.querySelector(args.form_selector);
      if (!form || form.tagName !== 'FORM') throw new Error('form not found');
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.submit();
      }
      return { ok: true, message: 'submit invoked' };
    },

    wait_for_selector(args) {
      requireAgentMode();
      const timeout = args.timeout_ms ?? 5000;
      const sel = args.selector;
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const tick = () => {
          if (!Neura.state.agentMode && !Neura.state.agentRunning) {
            reject(new Error('agent mode disabled'));
            return;
          }
          if (document.querySelector(sel)) {
            resolve({ ok: true, message: 'found' });
            return;
          }
          if (Date.now() - start > timeout) {
            reject(new Error('timeout waiting for selector'));
            return;
          }
          setTimeout(tick, 100);
        };
        tick();
      });
    },

    navigate_same_origin(args) {
      requireAgentMode();
      const href = new URL(args.url, window.location.href).href;
      if (new URL(href).origin !== window.location.origin) {
        return { crossOrigin: true, url: href };
      }
      window.location.assign(href);
      return { ok: true, message: 'navigation started' };
    },
  };
})(window.Neura);
