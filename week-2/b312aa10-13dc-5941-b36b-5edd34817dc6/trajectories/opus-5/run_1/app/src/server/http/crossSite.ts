/** The one place the cross-site decision on state-changing requests is made. */
import type { IncomingHttpHeaders } from 'node:http';

function header(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function isStateChanging(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

export function isCrossSite(method: string, headers: IncomingHttpHeaders): boolean {
  if (!isStateChanging(method)) return false;
  const host = header(headers, 'host');
  const ownOrigin = `http://${host ?? ''}`;
  const origin = header(headers, 'origin');
  if (origin !== null) return origin !== ownOrigin;

  const fetchSite = header(headers, 'sec-fetch-site');
  if (fetchSite !== null) return fetchSite === 'cross-site' || fetchSite === 'same-site';

  const referer = header(headers, 'referer');
  if (referer !== null) {
    try {
      return new URL(referer).origin !== ownOrigin;
    } catch {
      return true;
    }
  }
  return false;
}
