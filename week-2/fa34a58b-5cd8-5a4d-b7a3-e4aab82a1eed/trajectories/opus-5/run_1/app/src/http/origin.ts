import type { IncomingMessage } from 'node:http';

/**
 * A request is same-origin when it carries no Origin header, or an Origin
 * matching the host it was sent to.
 */
export function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === '' || origin === 'null') return true;
  const host = request.headers.host;
  if (host === undefined) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  return parsed.host === host;
}
