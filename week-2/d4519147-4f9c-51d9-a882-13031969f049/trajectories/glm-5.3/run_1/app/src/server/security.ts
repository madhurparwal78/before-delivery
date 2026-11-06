// Security headers, cookies and tokens. One implementation of each rule.

import crypto from 'node:crypto';

export const PUBLIC_URL = process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173';

export function publicUrlOrigin(): string {
  try {
    return new URL(PUBLIC_URL).origin;
  } catch {
    return 'http://127.0.0.1:4173';
  }
}

export function isHttps(): boolean {
  return PUBLIC_URL.startsWith('https:');
}

export const SESSION_COOKIE = isHttps() ? '__Host-sw_session' : 'sw_session';

export function sessionCookieHeader(sessionId: string): string {
  const attrs = isHttps()
    ? `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`
    : `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/`;
  return attrs;
}

export function clearSessionCookie(): string {
  const base = isHttps() ? `${SESSION_COOKIE}=; HttpOnly; Secure` : `${SESSION_COOKIE}=; HttpOnly`;
  return `${base}; SameSite=Lax; Path=/; Max-Age=0`;
}

// Tokens carry at least 128 random bits, base64url encoded.
export function newToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function newSessionId(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function newCsrfToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function newNonce(): string {
  return crypto.randomBytes(24).toString('base64');
}

// The base security headers on every response. API and invitation responses
// add their own on top.
export function baseSecurityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
}

export function cspForHtml(nonce: string): string {
  return `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'nonce-${nonce}'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
}

// The Origin rule: refuses requests whose Origin does not match the addressed
// origin or the public URL, or whose Sec-Fetch-Site says cross-site.
export function originRulePassed(req: { headers: Record<string, string | string[] | undefined>; protocol: string }): boolean {
  const origin = header(req.headers, 'origin');
  const host = header(req.headers, 'host');
  if (origin !== undefined) {
    if (origin === 'null') return false;
    const addressed = `${req.protocol}://${host}`;
    if (origin !== addressed && origin !== publicUrlOrigin()) return false;
    return true;
  }
  const fetchSite = header(req.headers, 'sec-fetch-site');
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false;
  return true;
}

export function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

// ASCII filename for Content-Disposition: outside printable ASCII, and every
// " and \, replaced by _.
export function asciiFilename(name: string): string {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0x7E || ch === '"' || ch === '\\') out += '_';
    else out += ch;
  }
  return out;
}

// RFC 5987 encoding: UTF-8 bytes, percent-encoded in uppercase hex except
// letters, digits and the safe punctuation set.
const RFC5987_SAFE = /^[!#$&+-.^_`|~A-Za-z0-9]$/;

export function rfc5987Filename(name: string): string {
  const bytes = Buffer.from(name, 'utf8');
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (RFC5987_SAFE.test(ch)) out += ch;
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

export function contentDisposition(name: string): string {
  return `attachment; filename="${asciiFilename(name)}"; filename*=UTF-8''${rfc5987Filename(name)}`;
}

// No header may carry a raw control character or a byte outside Latin-1.
export function sanitizeHeaderValue(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0xff) out += '?';
    else out += ch;
  }
  return out;
}
