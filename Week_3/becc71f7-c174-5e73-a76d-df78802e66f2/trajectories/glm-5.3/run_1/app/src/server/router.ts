// The request pipeline: the one place the error-precedence ladder runs (DP-54).
//
//  1. Unknown route (404) / wrong method (405 + Allow)
//  2. Body over its size limit — while reading, before parsing, before authentication
//  3. Rate limit, as soon as its key is known
//  4. Authentication (401 unauthenticated / session_ended)
//  5. Unknown path id or token-bound resource (404, or 410 for a gone piece/page)
//  6. Role (403)
//  7. Content type (415)
//  8. Malformed JSON (400)
//  9. Reused till request key (409)
// 10. Body ids (404), then field validation (422)
// 11. State (409)
// 12. Stale edit (412)
// Outages (503) come after every rule above.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { matchRoute, methodsOf, sendError, readBody } from './http.js';
import { errors, ApiError } from './errors.js';
import { routes } from './routes.js';
import { resolveSession } from './routes/session.js';
import { roleAllows } from './auth.js';
import type { Services } from './services.js';
import type { RouteContext } from './http.js';

export async function handleRequest(req: IncomingMessage, res: ServerResponse, services: Services): Promise<void> {
  try {
    await route(req, res, services);
  } catch (err) {
    if (res.headersSent) { res.end(); return; }
    if (err instanceof ApiError) { sendError(res, err); return; }
    console.error('unhandled', err);
    sendError(res, errors.internal());
  }
}

async function route(req: IncomingMessage, res: ServerResponse, services: Services): Promise<void> {
  const base = `http://localhost:${services.config.publicPort}`;
  const url = new URL(req.url ?? '/', base);
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const now = new Date();

  const matched = matchRoute(routes, method, path);
  if (!matched) {
    const allowed = methodsOf(routes, path);
    if (allowed.length > 0) {
      sendError(res, errors.methodNotAllowed(allowed.join(', ')));
      return;
    }
    if (path.startsWith('/api/')) {
      sendError(res, errors.notFound());
      return;
    }
    const { serveShell } = await import('./shell.js');
    await serveShell(res, services, 404);
    return;
  }
  const route = matched.route;

  // 4. Authentication and 6. role, resolved from the cookie. A wrong role on a
  // signed-in member is 403; a session-less request is 401.
  const session = await resolveSession(services.pool, req.headers.cookie, now);
  const member = session && !session.ended ? session.member : null;

  if (route.auth !== 'public') {
    if (!session) throw errors.unauthenticated();
    if (session.ended) throw errors.sessionEnded();
  }
  if (route.auth !== 'public' && !roleAllows(route.auth, member?.role)) {
    throw errors.forbidden();
  }

  // 2. Body over its limit: answered as JSON while reading, before parsing or
  // authentication is used further. Photo and spreadsheet routes read here.
  let body: Buffer | null = null;
  if (route.bodyLimit > 0) {
    body = await readBody(req, route.bodyLimit, res);
  }

  const ctx: RouteContext = {
    method, path, url, req, res, params: matched.params, services,
    member, sessionToken: session?.token ?? null,
    body, json: undefined,
  };
  await route.handle(ctx);
}
