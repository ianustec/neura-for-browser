(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'agent_exec') return false;

    // Page tools only run in the top frame (avoids iframe answering first).
    if (window !== window.top) {
      return false;
    }

    const extId = chrome.runtime.id;
    if (!sender.id || sender.id !== extId) {
      sendResponse({ ok: false, error: 'invalid sender' });
      return false;
    }

    // SW marks active agent turns so page tools work after navigation.
    // Do NOT flip agentMode here — that must reflect only the user's toggle.
    if (msg.agentSession && window.Neura?.state) {
      window.Neura.state.agentRunning = true;
    }

    if (!window.Neura?.state?.agentMode && !window.Neura?.state?.agentRunning) {
      sendResponse({ ok: false, error: 'agent mode disabled' });
      return false;
    }

    const name = msg.name;
    if (name === '__ping__') {
      sendResponse({ ok: true, result: { pong: true } });
      return false;
    }

    const args = msg.args && typeof msg.args === 'object' ? msg.args : {};
    const fn = window.Neura.agentTools?.[name];
    if (!fn) {
      sendResponse({ ok: false, error: `unknown page tool: ${name}` });
      return false;
    }

    Promise.resolve()
      .then(() => fn.call(window.Neura.agentTools, args))
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e.message || e) });
      });

    return true;
  });
})();
