import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { ApiError } from './errors.js';
import type { PersonRow, Role, SessionRow } from './types.js';

export type Caller = { person: PersonRow; session: SessionRow };

export type Ctx = {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
  caller: Caller;
  header: (name: string) => string | null;
  setCookie: (value: string) => void;
};

export type PublicCtx = Omit<Ctx, 'caller'> & { caller: Caller | null };

export type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export type Route = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  roles?: readonly Role[];
  handler: (ctx: Ctx) => Promise<Reply>;
};

export type PublicRoute = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  open: true;
  handler: (ctx: PublicCtx) => Promise<Reply>;
};

export type StreamRoute = {
  method: 'GET';
  path: string;
  stream: (ctx: Ctx, res: ServerResponse) => void;
};

type AnyRoute = Route | PublicRoute | StreamRoute;

const DEFAULT_BODY_LIMIT = 16_384;
const IMPORT_BODY_LIMIT = 1_000_000;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export type Authenticator = (
  cookieValue: string | null,
) => Promise<{ caller: Caller } | { refusal: ApiError }>;

export type LockoutGuard = (ctx: PublicCtx) => Promise<void>;

export type IdempotencyRunner = (
  ctx: Ctx,
  endpoint: string,
  run: () => Promise<Reply>,
) => Promise<Reply>;

type Matched = { route: AnyRoute; params: Record<string, string> };

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const wanted = pattern.split('/');
  const given = path.split('/');
  if (wanted.length !== given.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < wanted.length; index += 1) {
    const slot = wanted[index] as string;
    const value = given[index] as string;
    if (slot.startsWith(':')) {
      if (value === '') return null;
      params[slot.slice(1)] = decodeURIComponent(value);
    } else if (slot !== value) {
      return null;
    }
  }
  return params;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string>): void {
  const payload = Buffer.from(JSON.stringify(body ?? null), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readRequestBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.byteLength;
    if (size > limit) throw new ApiError(413, 'too_large', 'That request body is too large.');
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

export function createHttpServer(options: {
  routes: readonly AnyRoute[];
  clientRoot: string;
  authenticate: Authenticator;
  lockoutGuard: LockoutGuard;
  runIdempotent: IdempotencyRunner;
  idempotentEndpoints: ReadonlySet<string>;
  log: (message: string) => void;
}) {
  const { routes, clientRoot, authenticate, lockoutGuard, runIdempotent, idempotentEndpoints, log } = options;

  function find(method: string, path: string): Matched | null {
    for (const route of routes) {
      if (route.method !== method) continue;
      const params = matchPath(route.path, path);
      if (params !== null) return { route, params };
    }
    return null;
  }

  async function serveAsset(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const requested = path === '/' ? '/index.html' : path;
    // A path that names a file but is not a built asset is not served at all.
    const namesFile = extname(requested) !== '';
    const resolved = normalize(join(clientRoot, requested));
    if (!resolved.startsWith(clientRoot + sep) && resolved !== join(clientRoot, 'index.html')) {
      await missing(req, res, namesFile);
      return;
    }
    try {
      const info = await stat(resolved);
      if (!info.isFile()) {
        await missing(req, res, namesFile);
        return;
      }
      const type = MIME[extname(resolved)] ?? 'application/octet-stream';
      const immutable = resolved.includes(`${sep}assets${sep}`) || extname(resolved) === '.woff2';
      res.writeHead(200, {
        'content-type': type,
        'content-length': String(info.size),
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      createReadStream(resolved).pipe(res);
    } catch {
      await missing(req, res, namesFile);
    }
  }

  async function missing(req: IncomingMessage, res: ServerResponse, namesFile: boolean): Promise<void> {
    if (!namesFile) {
      await serveIndex(req, res);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'Nothing in this drawer.' } }));
  }

  async function serveIndex(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const indexPath = join(clientRoot, 'index.html');
    try {
      const info = await stat(indexPath);
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(info.size),
        'cache-control': 'no-cache',
      });
      createReadStream(indexPath).pipe(res);
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The drawer is not built.');
    }
  }

  return createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: { code: 'server_error', message: 'Something went wrong.' } }, {});
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (!path.startsWith('/api')) {
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 404, { error: { code: 'not_found', message: 'Nothing in this drawer.' } }, {});
        return;
      }
      await serveAsset(req, res, url.pathname);
      return;
    }

    const cookies: string[] = [];
    const header = (name: string): string | null => {
      const value = req.headers[name.toLowerCase()];
      if (value === undefined) return null;
      return Array.isArray(value) ? (value[0] ?? null) : value;
    };

    try {
      if (path.startsWith('/api/audit') && method !== 'GET') {
        throw new ApiError(405, 'method_not_allowed', 'The audit trail is append-only.');
      }

      // 1. Same origin only.
      if (WRITE_METHODS.has(method)) {
        const origin = header('origin');
        if (origin !== null && origin !== 'null') {
          let originHost: string | null = null;
          try {
            originHost = new URL(origin).host;
          } catch {
            originHost = null;
          }
          if (originHost === null || originHost !== (req.headers.host ?? '')) {
            throw new ApiError(403, 'cross_origin', 'This request came from another origin.');
          }
        }
      }

      const matched = find(method, path);

      // 2. Body size.
      const limit = path === '/api/imports' ? IMPORT_BODY_LIMIT : DEFAULT_BODY_LIMIT;
      const raw = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readRequestBody(req, limit);

      // 3. Content type.
      if (raw.byteLength > 0) {
        const contentType = (header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
        if (contentType !== 'application/json') {
          throw new ApiError(415, 'unsupported_media_type', 'Send this as JSON.');
        }
      }

      let body: unknown = {};
      if (raw.byteLength > 0) {
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {
          throw new ApiError(422, 'invalid', 'Check the highlighted fields.', { fields: {} });
        }
      }

      if (matched === null) {
        throw new ApiError(404, 'not_found', 'Nothing in this drawer.');
      }

      const base = {
        method,
        path,
        query: url.searchParams,
        params: matched.params,
        body,
        header,
        setCookie: (value: string) => cookies.push(value),
      };

      if ('open' in matched.route) {
        const ctx: PublicCtx = { ...base, caller: null };
        const cookieValue = readCookie(req.headers.cookie, 'lockset_session');
        if (cookieValue !== null) {
          const outcome = await authenticate(cookieValue);
          if ('caller' in outcome) ctx.caller = outcome.caller;
        }
        // 4. Sign-in lockout, before any credential check.
        await lockoutGuard(ctx);
        const reply = await matched.route.handler(ctx);
        send(res, reply, cookies);
        return;
      }

      // 5. Session checks.
      const outcome = await authenticate(readCookie(req.headers.cookie, 'lockset_session'));
      if ('refusal' in outcome) throw outcome.refusal;
      const ctx: Ctx = { ...base, caller: outcome.caller };

      if ('stream' in matched.route) {
        matched.route.stream(ctx, res);
        return;
      }

      const endpoint = `${matched.route.method} ${matched.route.path}`;
      const route = matched.route;
      const run = async (): Promise<Reply> => {
        // 8. Role.
        if (route.roles !== undefined && !route.roles.includes(ctx.caller.person.role)) {
          throw new ApiError(403, 'forbidden', 'This is not yours to do.');
        }
        return route.handler(ctx);
      };

      // 6. An idempotent replay answers before any later check.
      const reply = idempotentEndpoints.has(endpoint) ? await runIdempotent(ctx, endpoint, run) : await run();
      send(res, reply, cookies);
    } catch (error) {
      if (error instanceof ApiError) {
        send(res, { status: error.status, body: error.body(), headers: error.headers }, cookies);
        return;
      }
      log(`request failed: ${method} ${path}`);
      send(res, { status: 500, body: { error: { code: 'server_error', message: 'Something went wrong.' } } }, cookies);
    }
  }

  function send(res: ServerResponse, reply: Reply, cookies: string[]): void {
    const headers: Record<string, string> = { ...(reply.headers ?? {}) };
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);
    if (reply.status === 204) {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    sendJson(res, reply.status, reply.body, headers);
  }
}
