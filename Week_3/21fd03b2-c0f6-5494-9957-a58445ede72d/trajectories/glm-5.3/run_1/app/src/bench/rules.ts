// Safe return path rule (Business rules: Landing routes).
// The value arrives as the query string carries it once decoded; the rule then
// percent-decodes it once more before applying the safety checks.
export function isSafeReturnPath(value: string): boolean {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  return safeReturnChecks(decoded);
}

// The landing route a sign-in should follow for a given return value, or null.
export function safeReturnLanding(value: string): string | null {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  return isSafeReturnPath(value) ? decoded : null;
}

function safeReturnChecks(decoded: string): boolean {
  if (!decoded.startsWith('/')) return false;
  if (decoded.length >= 2) {
    const second = decoded.charAt(1);
    if (second === '/' || second === '\\') return false;
  }
  for (let i = 0; i < decoded.length; i++) {
    const code = decoded.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  if (decoded.startsWith('/api/')) return false;
  return true;
}

export function encodeReturnStrict(path: string): string {
  let out = '';
  const safe = /[A-Za-z0-9\-_.!~*'()]/;
  for (const ch of path) {
    if (safe.test(ch)) out += ch;
    else {
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}
