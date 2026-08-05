/** @type {Map<string, (approved: boolean) => void>} */
const pending = new Map();

export function registerConfirmResolver(confirmId, resolve) {
  pending.set(confirmId, resolve);
}

export function resolveAgentConfirm(confirmId, approved) {
  const fn = pending.get(confirmId);
  if (fn) {
    pending.delete(confirmId);
    fn(!!approved);
  }
}

export function clearAllAgentConfirms() {
  for (const [, fn] of pending) {
    try {
      fn(false);
    } catch {
      /* ignore */
    }
  }
  pending.clear();
}
