/**
 * The one safe-path check, applied after one round of percent-decoding.
 * A safe path starts with exactly one '/', never '//' or '/\', contains no
 * backslash, no control characters and no scheme, and is at most 512 chars.
 */
export function isSafePath(rawPath: string): boolean {
  let p = rawPath;
  try {
    p = decodeURIComponent(rawPath);
  } catch {
    return false;
  }
  if (p.length === 0 || p.length > 512) return false;
  if (!p.startsWith('/')) return false;
  if (p.startsWith('//') || p.startsWith('/\\')) return false;
  if (p.includes('\\')) return false;
  for (const ch of p) {
    const c = ch.codePointAt(0);
    if (c !== undefined && (c < 0x20 || c === 0x7f)) return false;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p.slice(1))) return false;
  return true;
}

/** Rewrites a /en/ or /fr/ path prefix to the target locale, adding it when missing. */
export function localePath(locale: string, next: string): string {
  if (!isSafePath(next)) return `/${locale}/`;
  const m = /^\/(en|fr)(\/|$)/.exec(next);
  if (m) {
    const rest = next.slice(m[0].length - (m[0].endsWith('/') ? 1 : 0));
    return `/${locale}${rest.startsWith('/') ? rest : `/${rest}`}`;
  }
  return `/${locale}${next}`;
}
