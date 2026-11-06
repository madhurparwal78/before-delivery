// The HTTP server: routing, the request boundary (body limits, CSRF, origin), error precedence,
// security headers and static serving of the built client only.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { errors, sendError, ApiError } from './errors.ts';
import { getApp, isConnectionError } from './runtime.ts';
import { loadAccount, loadSession, parseCookies, csrfMatches, type SessionRow, type AccountRow } from './sessions.ts';

export const BODY_LIMIT = 65536;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  session: SessionRow | null;
  account: AccountRow | null;
  now: number;
}

export type Auth = 'public' | 'session' | 'session-verified' | 'operator' | 'session-clan' | 'session-clan-verified';

export interface HandlerResult {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Route {
  method: string;
  path: string;
  auth: Auth;
  handler: (ctx: Ctx) => Promise<HandlerResult | undefined>;
}

const routes: Route[] = [];

export function route(method: string, path: string, auth: Auth, handler: Route['handler']): void {
  routes.push({ method, path, auth, handler });
}

// Static routes are registered before parameterised ones so that, say, /api/clan/leave is not
// swallowed by /api/clan/:id patterns.
function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const staticRoutes: Route[] = [];
  const dynamicRoutes: Route[] = [];
  for (const r of routes) (r.path.includes(':') ? dynamicRoutes : staticRoutes).push(r);
  for (const list of [staticRoutes, dynamicRoutes]) {
    for (const r of list) {
      if (r.method !== method) continue;
      const rParts = r.path.split('/').filter(Boolean);
      const pParts = path.split('/').filter(Boolean);
      if (rParts.length !== pParts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < rParts.length; i++) {
        const rp = rParts[i];
        if (rp.startsWith(':')) {
          params[rp.slice(1)] = pParts[i];
        } else if (rp !== pParts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { route: r, params };
    }
  }
  return null;
}

// A path id is valid only when written as plain decimal digits without a leading zero, in range.
export function pathId(ctx: Ctx, name: string): number {
  const raw = ctx.params[name];
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) throw errors.notFound();
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > 9007199254740991) throw errors.notFound();
  return n;
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'"
  );
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > BODY_LIMIT) {
      reject(errors.payloadTooLarge());
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(errors.payloadTooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const STATIC_ROOT = fileURLToPath(new URL('./public/', import.meta.url));

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const clean = decodeURIComponent(urlPath.split('?')[0].replace(/\/+$/, '')) || '/';
  try {
    if (clean.includes('..')) throw new Error('escape');
    if (clean === '/') {
      const file = await readFile(join(STATIC_ROOT, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      res.end(file);
      return;
    }
    const ext = extname(clean);
    if (ext !== '') {
      const candidate = join(STATIC_ROOT, clean);
      const info = await stat(candidate).catch(() => null);
      if (info?.isFile()) {
        const file = await readFile(candidate);
        res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
        res.end(file);
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const file = await readFile(join(STATIC_ROOT, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function headerAsString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function startServer(): Promise<void> {
  const app = getApp();
  const server = createServer(async (req, res) => {
    setSecurityHeaders(res);
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname;
    const now = app.clock.now();

    if (!path.startsWith('/api')) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(res, path);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }

    const ctx: Ctx = {
      req,
      res,
      method: req.method ?? 'GET',
      path,
      params: {},
      query: url.searchParams,
      body: {},
      session: null,
      account: null,
      now,
    };

    try {
      // 1. Body size, content type and JSON syntax take precedence over everything else.
      if (ctx.method === 'POST' || ctx.method === 'PATCH' || ctx.method === 'PUT') {
        const raw = await readBody(req);
        if (raw.length > 0) {
          const contentType = headerAsString(req.headers['content-type']) ?? '';
          if (!contentType.toLowerCase().split(';')[0].trim().startsWith('application/json')) {
            throw errors.unsupportedMediaType();
          }
          try {
            ctx.body = JSON.parse(raw.toString('utf-8'));
          } catch {
            throw errors.malformedJson();
          }
        }
      }

      // 2. The database outage answer, except for the two routes that always answer.
      if (!app.dbUp && path !== '/api/health' && path !== '/api/status') {
        throw errors.databaseUnavailable();
      }

      if (app.dbUp) {
        const cookies = parseCookies(headerAsString(req.headers.cookie));
        ctx.session = await loadSession(cookies['saltreach_session']);
        if (ctx.session && ctx.session.accountId !== null) {
          ctx.account = await loadAccount(ctx.session.accountId);
          if (!ctx.account) {
            ctx.session = null;
            ctx.account = null;
          }
        }
      }

      const match = matchRoute(ctx.method, ctx.path);
      if (!match) throw errors.notFound();
      const r = match.route;
      ctx.params = match.params;

      // 3. Session routes without a valid session answer unauthenticated.
      if (r.auth !== 'public' && (!ctx.session || ctx.session.accountId === null || !ctx.account)) {
        throw errors.unauthenticated();
      }

      // 4. CSRF on every state-changing request: same origin plus the session's token.
      if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
        const origin = headerAsString(req.headers.origin);
        if (typeof origin === 'string' && origin !== app.env.appOrigin) throw errors.csrfFailed();
        if (!ctx.session) throw errors.csrfFailed();
        if (!csrfMatches(ctx.session, headerAsString(req.headers['x-csrf-token']))) throw errors.csrfFailed();
      }

      // 6-9. Operator, clan membership and verified checks in precedence order.
      if (r.auth === 'operator' && ctx.account!.role !== 'operator') throw errors.forbidden();
      if ((r.auth === 'session-clan' || r.auth === 'session-clan-verified') && ctx.account!.clanId === null) {
        throw errors.conflict('not_in_clan', 'You’re no longer in this clan.');
      }
      if ((r.auth === 'session-verified' || r.auth === 'session-clan-verified') && !ctx.account!.verified) {
        throw errors.emailNotVerified();
      }

      const result = await r.handler(ctx);
      if (res.headersSent) return;
      if (result === undefined) {
        res.writeHead(204);
        res.end();
        return;
      }
      const headers = result.headers ?? {};
      if (result.body === undefined) {
        res.writeHead(result.status ?? 204, headers);
        res.end();
        return;
      }
      const data = Buffer.from(JSON.stringify(result.body), 'utf-8');
      res.writeHead(result.status ?? 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': data.length,
        ...headers,
      });
      res.end(data);
    } catch (err) {
      if (err instanceof Error && isConnectionError(err)) {
        app.dbUp = false;
        sendError(res, errors.databaseUnavailable());
        return;
      }
      if (!(err instanceof ApiError)) {
        console.error('unhandled error on', ctx?.method, ctx?.path, err);
      }
      sendError(res, err);
    }
  });

  await new Promise<void>((resolve) => server.listen(app.env.appPort, '0.0.0.0', resolve));
  console.log(`saltreach serving on 0.0.0.0:${app.env.appPort}`);
}
