// A redirect target is safe only when it is a path on this site (adapted from the kit's safe_redirect module).
const CONTROL = /[\u0000-\u001f\u007f]/;

export function safeNext(target: string | null, fallback: string): string {
  if (!target) return fallback;
  let value = target;
  for (let pass = 0; pass < 4; pass++) {
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || CONTROL.test(value) || value.length > 2048) return fallback;
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) return target;
      value = decoded;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
