/**
 * Verbose debug logging for Neura background / content.
 * Toggle: chrome.storage.sync.set({ neuraDebug: true|false })
 * Default: false (unset → off). Enable explicitly for local debugging.
 *
 * Format: [Neura:scope] +0ms | +12ms message …
 *   - first number: ms since process/module load
 *   - second: ms since previous log in the same scope
 */

let enabled = false;
let loaded = false;
const startedAt = Date.now();
/** @type {Record<string, number>} */
const lastByScope = Object.create(null);

async function refresh() {
  try {
    const { neuraDebug } = await chrome.storage.sync.get(['neuraDebug']);
    enabled = neuraDebug === true;
    loaded = true;
  } catch {
    enabled = false;
    loaded = true;
  }
}

refresh();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.neuraDebug) {
    enabled = changes.neuraDebug.newValue === true;
  }
});

function stamp(scope) {
  const now = Date.now();
  const sinceStart = now - startedAt;
  const prev = lastByScope[scope];
  const sincePrev = prev == null ? 0 : now - prev;
  lastByScope[scope] = now;
  const t = new Date(now).toISOString().slice(11, 23);
  return `${t} +${sinceStart}ms | +${sincePrev}ms`;
}

/**
 * @param {string} scope
 * @param {...unknown} args
 */
export function dlog(scope, ...args) {
  const emit = () => {
    if (!enabled) return;
    console.log(`[Neura:${scope}]`, stamp(scope), ...args);
  };
  if (!loaded) {
    refresh().then(emit);
    return;
  }
  emit();
}

/**
 * @param {string} scope
 * @param {...unknown} args
 */
export function dwarn(scope, ...args) {
  const emit = () => {
    if (!enabled && loaded) return;
    console.warn(`[Neura:${scope}]`, stamp(scope), ...args);
  };
  if (!loaded) {
    refresh().then(emit);
    return;
  }
  emit();
}

export function isDebugEnabled() {
  return enabled;
}
