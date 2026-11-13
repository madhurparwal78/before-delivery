import type { IncomingMessage } from 'node:http';

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
};

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function headerOf(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function ownOrigin(request: IncomingMessage): string {
  const host = headerOf(request, 'host') ?? '';
  return `http://${host}`;
}

/** The one cross-site rule, applied before authentication. */
export function isCrossSite(request: IncomingMessage, originSensitiveRead: boolean): boolean {
  const method = (request.method ?? 'GET').toUpperCase();
  const stateChanging = STATE_CHANGING_METHODS.has(method);
  if (!stateChanging && !originSensitiveRead) return false;

  const origin = headerOf(request, 'origin');
  if (origin !== null) {
    if (origin === 'null') return true;
    return origin !== ownOrigin(request) && origin !== ownOrigin(request).replace('http://', 'https://');
  }
  if (!stateChanging) return false;
  const fetchSite = headerOf(request, 'sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return true;
  return false;
}
