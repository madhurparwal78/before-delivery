// The safe return address after sign-in. The single home of the rule.

export const RETURN_MAX = 2000;

/**
 * A return address is safe only when it starts with exactly one "/", has no
 * backslash, scheme or control character, is at most 2,000 characters, and
 * its path is not /sign-in and does not start with /api/ or /s/.
 */
export function safeReturnAddress(raw: string): string | null {
  if (raw.length > RETURN_MAX) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (raw.includes("\\")) return null;
  // control characters
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  // a scheme before any /?#
  const qIdx = raw.indexOf("?");
  const hIdx = raw.indexOf("#");
  let end = raw.length;
  if (qIdx !== -1) end = Math.min(end, qIdx);
  if (hIdx !== -1) end = Math.min(end, hIdx);
  const path = raw.slice(0, end);
  if (path.includes(":")) return null;
  if (path === "/sign-in") return null;
  if (path === "/api" || path === "/s") return null;
  if (path.startsWith("/api/") || path.startsWith("/s/")) return null;
  return raw;
}
