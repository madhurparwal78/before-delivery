// Same-origin rule shared by writes and the socket handshake.

import type { IncomingMessage } from "node:http";

/** True when the request has no Origin header or its Origin is this request's own origin. */
export function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && parsed.host === request.headers.host;
  } catch {
    return false;
  }
}
