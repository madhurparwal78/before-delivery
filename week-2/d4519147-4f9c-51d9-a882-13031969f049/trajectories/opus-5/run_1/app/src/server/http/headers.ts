import type { ServerResponse } from 'node:http';

export type ResponseKind = 'api' | 'html' | 'download' | 'asset' | 'redirect';

export interface HeaderOptions {
  nonce?: string;
  noReferrer?: boolean;
  noStore?: boolean;
}

const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

export function contentSecurityPolicyFor(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** The single place that writes the published security headers. */
export function applySecurityHeaders(res: ServerResponse, kind: ResponseKind, options: HeaderOptions = {}): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', options.noReferrer ? 'no-referrer' : 'same-origin');
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  switch (kind) {
    case 'api':
      res.setHeader('Cache-Control', 'no-store');
      break;
    case 'html':
      if (!options.nonce) throw new Error('html responses need a nonce');
      res.setHeader('Content-Security-Policy', contentSecurityPolicyFor(options.nonce));
      res.setHeader('Cache-Control', 'no-store');
      break;
    case 'download':
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'no-store');
      break;
    case 'asset':
      res.setHeader('Cache-Control', options.noStore ? 'no-store' : 'public, max-age=3600');
      break;
    case 'redirect':
      if (options.noStore) res.setHeader('Cache-Control', 'no-store');
      break;
  }
}

const ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/;

/** `attachment; filename="<ascii>"; filename*=UTF-8''<encoded>` */
export function contentDisposition(fileName: string): string {
  let ascii = '';
  for (const char of fileName) {
    const code = char.codePointAt(0) ?? 0;
    ascii += code >= 0x20 && code <= 0x7e && char !== '"' && char !== '\\' ? char : '_';
  }
  let encoded = '';
  for (const byte of Buffer.from(fileName, 'utf8')) {
    const char = String.fromCharCode(byte);
    encoded += ATTR_CHAR.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
