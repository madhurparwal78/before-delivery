export const DEFAULT_LANDING = '/tonight';

/**
 * The one place that decides whether a `next` value is a safe path on this
 * origin. Anything else falls back to the default landing.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_LANDING;
  let value = raw;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      return DEFAULT_LANDING;
    }
  }
  if (!value.startsWith('/')) return DEFAULT_LANDING;
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_LANDING;
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_LANDING;
  const path = value.split(/[?#]/)[0] ?? '';
  if (path === '/signin' || path === '/signup') return DEFAULT_LANDING;
  return value;
}
