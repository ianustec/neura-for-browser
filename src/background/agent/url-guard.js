const BLOCKED_PROTOCOLS = new Set([
  'javascript:',
  'file:',
  'chrome:',
  'chrome-extension:',
  'about:',
  'data:',
  'blob:',
]);

/**
 * @param {string} urlStr
 * @param {string} [baseUrl] current tab URL for relative resolution
 * @returns {{ blocked: boolean, reason?: string, href?: string, sameOrigin?: boolean }}
 */
export function classifyNavigateUrl(urlStr, baseUrl) {
  if (!urlStr || typeof urlStr !== 'string') {
    return { blocked: true, reason: 'missing url' };
  }
  let resolved;
  try {
    resolved = new URL(urlStr.trim(), baseUrl || 'https://example.invalid/');
  } catch {
    return { blocked: true, reason: 'invalid url' };
  }
  const proto = `${resolved.protocol.toLowerCase()}`;
  if (BLOCKED_PROTOCOLS.has(proto)) {
    return { blocked: true, reason: `blocked scheme: ${proto}` };
  }
  if (proto !== 'http:' && proto !== 'https:') {
    return { blocked: true, reason: `unsupported scheme: ${proto}` };
  }
  let baseOrigin = '';
  try {
    baseOrigin = baseUrl ? new URL(baseUrl).origin : '';
  } catch {
    baseOrigin = '';
  }
  const sameOrigin = baseOrigin ? resolved.origin === baseOrigin : false;
  return { blocked: false, href: resolved.href, sameOrigin };
}
