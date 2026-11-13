import crypto from 'node:crypto';

const NONCE_BYTES = 16;

export function freshScriptNonce(): string {
  return crypto.randomBytes(NONCE_BYTES).toString('base64');
}

export function securityHeaders(nonce: string, frameAncestors: string, sandboxed = false): Record<string, string> {
  const policy = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "object-src 'none'",
    "base-uri 'none'",
    sandboxed ? 'sandbox' : '',
    `frame-ancestors ${frameAncestors}`,
  ]
    .filter((part) => part !== '')
    .join('; ');
  return {
    'content-security-policy': policy,
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
}
