/**
 * The safe-return rule. `value` is the `return` parameter as the query string
 * carries it once decoded; it is decoded once more before the checks.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/')) return null;
  if (decoded.length > 1 && (decoded[1] === '/' || decoded[1] === '\\')) return null;
  for (const character of decoded) {
    const code = character.codePointAt(0) as number;
    if (code <= 0x1f || code === 0x7f) return null;
  }
  if (decoded.startsWith('/api/')) return null;
  return value;
}

/** Percent-encodes a screen's path and query for `/sign-in?return=`. */
export function encodeReturnPath(pathAndQuery: string): string {
  return encodeURIComponent(pathAndQuery);
}

export function signInWithReturn(pathAndQuery: string): string {
  return `/sign-in?return=${encodeReturnPath(pathAndQuery)}`;
}
