const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * True only for a same-origin path: one leading `/`, no `//`, no backslash, no control character, no scheme, and the
 * same after each of up to three percent-decodings (adapted from kit/modules/safe_redirect).
 */
function isSafePath(target: unknown): target is string {
  if (typeof target !== 'string' || target.length > 2048) return false;
  let s = target;
  for (let round = 0; round < 3; round++) {
    if (CONTROL.test(s) || s.includes('\\') || !s.startsWith('/') || s.startsWith('//')) return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      return false;
    }
    if (decoded === s) return new URL(target, 'http://origin.invalid').origin === 'http://origin.invalid';
    s = decoded;
  }
  return false;
}

/** The landing path after sign-in: `next` when safe, otherwise `/today`. */
export function landingPath(next: unknown): string {
  return isSafePath(next) ? next : '/today';
}
