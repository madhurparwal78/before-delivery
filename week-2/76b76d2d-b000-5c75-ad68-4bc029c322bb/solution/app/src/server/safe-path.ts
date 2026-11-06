/**
 * A safe same-origin path, checked after one round of percent-decoding: exactly one leading `/`,
 * no `//` or `/\` start, no `\`, no control characters, no scheme, at most 512 characters.
 */
export function safePath(raw: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return false;
  }
  if (raw.length > 512 || path.length > 512) return false;
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return false;
  if (path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(path.slice(1));
}
