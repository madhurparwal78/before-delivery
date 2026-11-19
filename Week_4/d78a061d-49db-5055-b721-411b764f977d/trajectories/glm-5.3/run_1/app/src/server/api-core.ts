import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, json, readJsonBody, sendError, notFound, unauthenticated } from './http.js';
import { contextFrom, crossOriginForbidden, type Ctx } from './context.js';

export type Handler = (ctx: Ctx, match: RegExpMatchArray, res: ServerResponse, req: IncomingMessage) => Promise<void>;

export type Route = { method: string; pattern: RegExp; handler: Handler; needsAuth: boolean };

export function route(method: string, pattern: string, handler: Handler, needsAuth = true): Route {
  return { method, pattern: new RegExp(`^${pattern}$`), handler, needsAuth };
}

/** Shared API dispatch: precedence and error handling in one place. */
export async function dispatch(routes: Route[], req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname;
  if (!path.startsWith('/api/')) return false;
  const ctx = await contextFrom(req);
  if (crossOriginForbidden(req) && req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, new ApiError(403, 'cross_origin'), ctx.locale);
    return true;
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = path.match(r.pattern);
    if (!match) continue;
    if (r.needsAuth && !ctx.account) {
      sendError(res, unauthenticated(), ctx.locale);
      return true;
    }
    try {
      await r.handler(ctx, match, res, req);
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, err, ctx.locale);
      } else {
        console.error('unhandled api error', err);
        sendError(res, new ApiError(500, 'internal'), ctx.locale);
      }
    }
    return true;
  }
  sendError(res, notFound(), ctx.locale);
  return true;
}

export { json, readJsonBody, ApiError, notFound, unauthenticated, sendError };
export { contextFrom, crossOriginForbidden };
export type { Ctx };
