/** The cross-site request check, decided here and nowhere else. */
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RequestOriginHeaders {
  method: string;
  origin: string | undefined;
  host: string | undefined;
  secFetchSite: string | undefined;
}

function hostPortOfOrigin(origin: string): { hostname: string; port: string } | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80';
  return { hostname: url.hostname.toLowerCase(), port };
}

function hostPortOfHostHeader(host: string, originPort: string): { hostname: string; port: string } | null {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    if (close < 0) return null;
    const hostname = trimmed.slice(1, close);
    const rest = trimmed.slice(close + 1);
    return { hostname, port: rest.startsWith(':') ? rest.slice(1) : originPort };
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon < 0) return { hostname: trimmed, port: originPort };
  return { hostname: trimmed.slice(0, colon), port: trimmed.slice(colon + 1) };
}

export function isCrossSiteWrite(headers: RequestOriginHeaders): boolean {
  if (!STATE_CHANGING.has(headers.method.toUpperCase())) return false;
  const origin = headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    if (origin === 'null') return true;
    const originParts = hostPortOfOrigin(origin);
    if (originParts === null) return true;
    const hostParts =
      typeof headers.host === 'string' ? hostPortOfHostHeader(headers.host, originParts.port) : null;
    if (hostParts === null) return true;
    return originParts.hostname !== hostParts.hostname || originParts.port !== hostParts.port;
  }
  const site = headers.secFetchSite?.trim().toLowerCase();
  return site === 'cross-site' || site === 'same-site';
}
