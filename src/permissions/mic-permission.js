const MESSAGE_SOURCE = 'neura-mic-permission';
const embed = new URLSearchParams(location.search).has('embed');

if (embed) {
  document.documentElement.classList.add('embed');
}

const btn = document.getElementById('grant');
const status = document.getElementById('status');

if (!btn || !status) {
  throw new Error('Mic permission page: missing UI elements');
}

function notifyParent(payload) {
  if (!embed || window.parent === window) return;
  window.parent.postMessage({ source: MESSAGE_SOURCE, ...payload }, '*');
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  status.className = '';
  status.textContent = 'Richiesta in corso…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    status.className = 'ok';
    status.textContent = embed
      ? 'Microfono abilitato.'
      : 'Microfono abilitato. Puoi chiudere questa scheda e tornare a Neura.';
    notifyParent({ granted: true });
  } catch (err) {
    status.className = 'err';
    status.textContent =
      'Permesso negato o microfono non disponibile: ' +
      (err && err.message ? err.message : err);
    btn.disabled = false;
    notifyParent({ denied: true });
  }
});
