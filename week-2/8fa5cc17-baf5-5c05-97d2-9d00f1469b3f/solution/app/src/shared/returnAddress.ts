// The safe return address after sign-in.

export const RETURN_CAP = 2000;

/** `raw` is the `return` query parameter after one percent-decoding. */
export function safeReturn(raw: string | null): string | null {
  if (raw === null || raw.length === 0 || raw.length > RETURN_CAP) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return null;
  const path = raw.split(/[?#]/, 1)[0];
  if (/^[a-z][a-z0-9+.-]*:/i.test(path.slice(1)) || path.includes('://')) return null;
  if (path === '/sign-in' || path === '/api' || path === '/s') return null;
  if (path.startsWith('/api/') || path.startsWith('/s/')) return null;
  return raw;
}
