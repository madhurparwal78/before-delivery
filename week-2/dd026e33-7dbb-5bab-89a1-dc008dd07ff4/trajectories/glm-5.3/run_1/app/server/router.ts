import type { IncomingMessage, ServerResponse } from 'node:http';
import { ERRORS, writeError, isOriginAllowed, ApiError } from './errors.ts';
import type { AppCtx, Viewer } from './context.ts';
import { makeViewer } from './context.ts';
import { checkSession, sessionEndedError } from './session.ts';
import { readJsonBody, ClientGone } from './httpio.ts';

export interface RouteParams {
  [name: string]: string;
}

export interface RequestBody {
  json: unknown;
  raw: string;
}

export interface RouteContext {
  ctx: AppCtx;
  req: IncomingMessage;
  res: ServerResponse;
  params: RouteParams;
  viewer: Viewer;
  query: URLSearchParams;
  url: URL;
  body: unknown;
  idempotencyKey: string | null;
}

export type Handler = (rc: RouteContext) => Promise<{ status: number; body?: unknown; headers?: Record<string, string> }>;

export interface Route {
  method: string;
  pattern: string;
  roles?: string[]; // documentation of the role table; enforcement lives in handlers
  needsSession: boolean;
  handler: Handler;
}

export function route(
  method: string,
  pattern: string,
  options: { roles?: string[]; noSession?: boolean },
  handler: Handler,
): Route {
  return {
    method,
    pattern,
    roles: options.roles,
    needsSession: !options.noSession,
    handler,
  };
}

export interface MatchResult {
  route: Route;
  params: RouteParams;
}

export function matchRoute(routes: Route[], method: string, pathname: string): MatchResult | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const candidateParts = candidate.pattern.split('/');
    const pathParts = pathname.split('/');
    if (candidateParts.length !== pathParts.length) continue;
    const params: RouteParams = {};
    let ok = true;
    for (let i = 0; i < candidateParts.length; i++) {
      const patternPart = candidateParts[i];
      const pathPart = pathParts[i];
      if (patternPart.startsWith('{') && patternPart.endsWith('}')) {
        if (pathPart === '') {
          ok = false;
          break;
        }
        params[patternPart.slice(1, -1)] = decodeURIComponent(pathPart);
      } else if (patternPart !== pathPart) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: candidate, params };
  }
  return null;
}

export function parseCookie(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    result[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return result;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function dispatch(
  ctx: AppCtx,
  routes: Route[],
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/') && pathname !== '/api') return false;

  const method = req.method ?? 'GET';
  const match = matchRoute(routes, method, pathname);

  try {
    if (!match) {
      writeError(res, ERRORS.notFound());
      return true;
    }

    // 1. Origin for state-changing requests (read body limits are enforced by readJsonBody)
    if (STATE_CHANGING.has(method) && !isOriginAllowed(req)) {
      writeError(res, ERRORS.forbidden());
      return true;
    }

    // 2. Session
    let viewer: Viewer | null = null;
    if (match.route.needsSession) {
      const cookies = parseCookie(req.headers.cookie);
      const sessionId = cookies['lacquer_session'] ?? '';
      if (sessionId === '') {
        writeError(res, ERRORS.unauthenticated());
        return true;
      }
      const session = await checkSession(ctx.db, sessionId);
      if (!session) {
        writeError(res, ERRORS.unauthenticated());
        return true;
      }
      if (session.ended) {
        writeError(res, sessionEndedError(session.ended));
        return true;
      }
      viewer = makeViewer(session.user, sessionId);
    }

    // 3. Body (size and content-type checks for JSON bodies); action routes
    //    that carry no body and no content type are not asked for JSON.
    let body: RequestBody | undefined;
    const contentTypeHeader = req.headers['content-type'] ?? '';
    const declaredLength = Number(req.headers['content-length'] ?? '0');
    const hasBody = contentTypeHeader !== '' || declaredLength > 0;
    if (STATE_CHANGING.has(method) && hasBody && !contentTypeHeader.includes('multipart/form-data')) {
      body = await readJsonBody(req);
    }

    const rc: RouteContext = {
      ctx,
      req,
      res,
      params: match.params,
      viewer: viewer as unknown as Viewer,
      query: url.searchParams,
      url,
      body: body ? body.json : undefined,
      idempotencyKey: (req.headers['idempotency-key'] as string | undefined) ?? null,
    };

    const result = await match.route.handler(rc);
    if (result.status === 204) {
      res.writeHead(204);
      res.end();
      return true;
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      ...(result.headers ?? {}),
    };
    res.writeHead(result.status, headers);
    res.end(result.body === undefined ? '' : JSON.stringify(result.body));
    return true;
  } catch (err) {
    if (err instanceof ClientGone) {
      if (!res.headersSent) {
        res.destroy();
      } else {
        res.destroy();
      }
      return true;
    }
    if (err instanceof ApiError) {
      writeError(res, err);
      return true;
    }
    // Unexpected internal error: log the stack for diagnosis, answer 500.
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'internal' }));
    return true;
  }
}
