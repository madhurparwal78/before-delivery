const CONTROL = /[\u0000-\u001f\u007f]/;

/** The one safe-path rule: checked after a single round of percent-decoding. */
export function isSafePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (decoded.length > 512) return false;
  if (!decoded.startsWith('/')) return false;
  if (decoded.startsWith('//') || decoded.startsWith('/\\')) return false;
  if (decoded.includes('\\')) return false;
  if (CONTROL.test(decoded)) return false;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(decoded)) return false;
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(decoded)) return false;
  return true;
}
