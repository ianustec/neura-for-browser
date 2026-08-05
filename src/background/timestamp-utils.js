/**
 * Normalize mixed Open WebUI / local timestamps to milliseconds since epoch.
 *
 * Local chats use Date.now() (ms ≈ 1.7e12). OWUI list/DB fields often use
 * seconds (≈ 1.7e9). Occasional clients send µs/ns.
 *
 * @param {unknown} ts
 * @returns {number} milliseconds, or 0 if invalid
 */
export function toMillis(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1e16) return Math.floor(n / 1e6); // nanoseconds → ms
  if (n > 1e14) return Math.floor(n / 1e3); // microseconds → ms
  if (n < 1e11) return Math.floor(n * 1000); // seconds → ms
  return Math.floor(n); // already milliseconds
}
