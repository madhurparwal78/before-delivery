import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';

import type { Role } from '../../shared/api.js';
import { parseRequestBody } from './boundary.js';
import type { AppContext, RequestContext } from './context.js';
import { HttpError, conflict, forbidden, methodNotAllowed, notFound, unauthenticated } from './errors.js';
import { loadSessionUser, readCookie, SESSION_COOKIE } from './session.js';

export interface RouteResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  buffer?: Buffer;
  text?: string;
  contentType?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RouteSpec<T = undefined> {
  method: HttpMethod;
  path: string;
  /** Public routes skip the session requirement. */
  public?: boolean;
  /** Roles permitted to perform the action; others get 403. */
  roles?: readonly Role[];
  /** Scoped lookup; raises 404 for an unknown id or one outside the caller's scope. */
  resolve?: (ctx: RequestContext) => Promise<T>;
  handle: (ctx: RequestContext, resolved: T) => Promise<RouteResult>;
  /** POSTs that carry no effect worth replaying opt out. */
  idempotent?: boolean;
  /** Only the upload route accepts multipart/form-data. */
  upload?: boolean;
}

/** A route with its resolved type erased, so routes can share one list. */
export interface Route {
  method: HttpMethod;
  path: string;
  public: boolean;
  roles: readonly Role[] | null;
  idempotent: boolean;
  upload: boolean;
  resolve: ((ctx: RequestContext) => Promise<unknown>) | null;
  handle: (ctx: RequestContext, resolved: unknown) => Promise<RouteResult>;
}

export function route<T>(spec: RouteSpec<T>): Route {
  return {
    method: spec.method,
    path: spec.path,
    public: spec.public ?? false,
    roles: spec.roles ?? null,
    idempotent: spec.idempotent ?? true,
    upload: spec.upload ?? false,
    resolve: spec.resolve === null || spec.resolve === undefined ? null : spec.resolve,
    handle: (ctx, resolved) => spec.handle(ctx, resolved as T),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

function pathPattern(path: string): RegExp {
  const source = path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${source}$`);
}

function sendResult(res: Response, result: RouteResult): void {
  for (const [name, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(name, value);
  }
  if (result.buffer !== undefined) {
    res.status(result.status).end(result.buffer);
    return;
  }
  if (result.text !== undefined) {
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType ?? 'text/html; charset=utf-8');
    res.end(result.text);
    return;
  }
  if (result.status === 204 || result.body === undefined) {
    res.status(result.status).end();
    return;
  }
  res.status(result.status).json(result.body);
}

async function withIdempotency(
  ctx: RequestContext,
  key: string,
  run: () => Promise<RouteResult>,
): Promise<RouteResult> {
  const userId = ctx.user?.id ?? '';
  const method = ctx.req.method;
  const path = ctx.req.baseUrl + ctx.req.path;
  const bodyHash = createHash('sha256').update(canonicalJson(ctx.body)).digest('hex');

  const claimed = await ctx.app.db.query(
    `INSERT INTO idempotency_keys (user_id, key, method, path, body_hash, state, created_at)
     VALUES ($1, $2, $3, $4, $5, 'running', $6)
     ON CONFLICT (user_id, key) DO NOTHING
     RETURNING key`,
    [userId, key, method, path, bodyHash, ctx.now],
  );

  if (claimed.rowCount === 0) {
    const stored = await ctx.app.db.query<{
      method: string;
      path: string;
      body_hash: string;
      state: string;
      response_status: number | null;
      response_body: unknown;
    }>(
      `SELECT method, path, body_hash, state, response_status, response_body
         FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
      [userId, key],
    );
    const row = stored.rows[0];
    if (row === undefined) {
      throw conflict('request_in_progress');
    }
    if (row.method !== method || row.path !== path || row.body_hash !== bodyHash) {
      throw new HttpError(422, 'idempotency_key_reused');
    }
    if (row.state === 'running') {
      throw conflict('request_in_progress');
    }
    return {
      status: row.response_status ?? 200,
      body: row.response_body ?? undefined,
      headers: { 'Idempotent-Replay': 'true' },
    };
  }

  try {
    const result = await run();
    await ctx.app.db.query(
      `UPDATE idempotency_keys SET state = 'done', response_status = $3, response_body = $4
        WHERE user_id = $1 AND key = $2`,
      [userId, key, result.status, result.body === undefined ? null : JSON.stringify(result.body)],
    );
    return result;
  } catch (error) {
    await ctx.app.db
      .query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key])
      .catch(() => undefined);
    throw error;
  }
}

function readIdempotencyKey(req: Request): string | null {
  const header = req.get('idempotency-key');
  if (header === undefined || header === '') return null;
  if (header.length > 100 || !/^[\x20-\x7e]+$/.test(header)) {
    throw new HttpError(422, 'validation_failed', { errors: { idempotency_key: 'invalid' } });
  }
  return header;
}

export function buildApiRouter(app: AppContext, specs: readonly Route[]): Router {
  const router = Router();
  const known = new Map<RegExp, Set<string>>();

  for (const spec of specs) {
    const pattern = pathPattern(spec.path);
    let methods: Set<string> | undefined;
    for (const [existing, set] of known) {
      if (existing.source === pattern.source) methods = set;
    }
    if (methods === undefined) known.set(pattern, new Set([spec.method]));
    else methods.add(spec.method);
  }

  for (const spec of specs) {
    const handler = async (req: Request, res: Response): Promise<void> => {
      const parsed = await parseRequestBody(req);
      if (parsed.multipart && !spec.upload) {
        throw new HttpError(415, 'unsupported_media_type');
      }
      const now = app.clock.now();
      const ctx: RequestContext = {
        app,
        req,
        res,
        now,
        today: app.clock.today(),
        user: await loadSessionUser(app.db, readCookie(req, SESSION_COOKIE)),
        body: parsed.value,
        rawBody: parsed.raw,
      };

      if (!spec.public && ctx.user === null) throw unauthenticated();

      const resolved = spec.resolve === null ? undefined : await spec.resolve(ctx);

      if (spec.roles !== null && (ctx.user === null || !spec.roles.includes(ctx.user.role))) {
        throw forbidden();
      }

      const run = (): Promise<RouteResult> => spec.handle(ctx, resolved);

      const key =
        spec.method === 'POST' && !spec.public && spec.idempotent
          ? readIdempotencyKey(req)
          : null;

      sendResult(res, key === null ? await run() : await withIdempotency(ctx, key, run));
    };

    const method = spec.method.toLowerCase() as Lowercase<HttpMethod>;
    router[method](spec.path, (req, res, next) => {
      handler(req, res).catch(next);
    });
  }

  // An unsupported method on a known path answers 405; anything else is 404.
  router.use((req, _res, next) => {
    // Route patterns are relative to the mount point, as `req.path` is here.
    const routePath = req.path;
    // Ledger history is append-only: no path under it accepts a write method.
    if (/^\/ledger(\/|$)/.test(routePath) && ['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      next(methodNotAllowed());
      return;
    }
    for (const [pattern, methods] of known) {
      if (pattern.test(routePath)) {
        next(methods.has(req.method) ? notFound() : methodNotAllowed());
        return;
      }
    }
    next(notFound());
  });

  return router;
}
