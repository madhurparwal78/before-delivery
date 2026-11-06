import type { IncomingMessage } from 'node:http';

function authorityOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    const port = parsed.port !== '' ? parsed.port : parsed.protocol === 'https:' ? '443' : '80';
    return `${parsed.hostname}:${port}`;
  } catch {
    return null;
  }
}

function hostAuthority(host: string): string {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host.trim());
  if (!match) return host;
  return `${match[1]}:${match[2] ?? '80'}`;
}

/** The one place the cross-site rule from Server boundary is decided. */
export function isCrossSiteStateChange(request: IncomingMessage): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return false;
  const fetchSite = request.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site') return true;
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return false;
  const host = request.headers.host;
  if (typeof host !== 'string') return true;
  const originAuthority = authorityOf(origin);
  if (originAuthority === null) return true;
  return originAuthority !== hostAuthority(host);
}
