import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, parseCookies, readFileBody, sendError } from './util.js';
import { loadSession, type SessionContext, type UserRow } from './auth.js';
import { pool, type Db } from './db.js';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  session: SessionContext | null;
  db: Db;
  user(): UserRow;
  body<T>(): Promise<T>;
  rawBody(): Promise<Buffer>;
}

type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    const paramNames: string[] = [];
    const source = path.replace(/\{(\w+)\}/g, (_, name) => {
      paramNames.push(String(name));
      return '([^/]+)';
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), paramNames, handler });
  }

  get(path: string, handler: Handler): void {
    this.add('GET', path, handler);
  }

  post(path: string, handler: Handler): void {
    this.add('POST', path, handler);
  }

  put(path: string, handler: Handler): void {
    this.add('PUT', path, handler);
  }

  delete(path: string, handler: Handler): void {
    this.add('DELETE', path, handler);
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]!);
      });
      return { route, params };
    }
    return null;
  }
}

export function makeCtx(req: IncomingMessage, res: ServerResponse, url: URL): Ctx {
  let bodyCache: unknown;
  let rawCache: Buffer | null = null;
  const ctx: Ctx = {
    req,
    res,
    url,
    params: {},
    session: null,
    db: null as unknown as Db,
    user(): UserRow {
      if (!ctx.session?.user) {
        throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
      }
      return ctx.session.user;
    },
    body<T>(): Promise<T> {
      return (async () => {
        if (bodyCache === undefined) {
          const contentType = req.headers['content-type'] ?? '';
          if (!contentType.startsWith('application/json')) {
            throw new HttpError(415, 'unsupported_media_type', 'Send JSON for this request.');
          }
          const raw = await readFileBody(req, 65_536).catch(() => {
            throw new HttpError(413, 'payload_too_large', 'That request is too large.');
          });
          if (raw.length === 0) {
            bodyCache = {};
          } else {
            try {
              bodyCache = JSON.parse(raw.toString('utf8')) as unknown;
            } catch {
              throw new HttpError(422, 'invalid_json', 'That request is not valid JSON.');
            }
          }
        }
        return bodyCache as T;
      })();
    },
    rawBody(): Promise<Buffer> {
      return (async () => {
        if (rawCache === null) {
          rawCache = await readFileBody(req, 10_100_000).catch(() => {
            throw new HttpError(413, 'file_too_large', 'That file is larger than 10 MB.');
          });
        }
        return rawCache;
      })();
    },
  };
  return ctx;
}

export async function resolveSession(ctx: Ctx): Promise<void> {
  const cookies = parseCookies(ctx.req.headers.cookie);
  const sessionId = cookies['pampero_session'];
  ctx.session = await loadSession(ctx.db, sessionId);
}

export function handleError(ctx: Ctx, err: unknown): void {
  if (err instanceof HttpError) {
    sendError(ctx.res, err);
    return;
  }
  console.error('unhandled error:', err);
  const message = err instanceof Error ? err.message : 'Something went wrong.';
  const dbFail = /ECONNREFUSED|Connection terminated|timeout expired|does not connect|SASL|password authentication|Terminating connection/i.test(message);
  sendError(ctx.res, new HttpError(dbFail ? 503 : 500, dbFail ? 'database_unavailable' : 'internal_error', dbFail ? 'The ledger is unreachable right now.' : 'Something went wrong.'));
}

export async function runHandler(router: Router, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const found = router.match(req.method ?? 'GET', url.pathname);
  if (!found) return false;
  const ctx = makeCtx(req, res, url);
  ctx.params = found.params;
  const db = await pool.connect();
  ctx.db = db;
  try {
    const origin = req.headers.origin;
    if (req.method !== 'GET' && req.method !== 'HEAD' && origin && new URL(origin).origin !== url.origin) {
      throw new HttpError(403, 'cross_origin', 'Requests from other origins are refused.');
    }
    await resolveSession(ctx);
    await found.route.handler(ctx);
  } catch (err) {
    handleError(ctx, err);
  } finally {
    db.release();
  }
  return true;
}
