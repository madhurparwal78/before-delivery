import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import {
  countRate,
  keyByValue,
  patternMatches,
  roleAllows,
  SESSION_COOKIE,
  userOfSession,
  type Caller,
  type Role,
} from './auth.js';
import { one } from './db.js';
import { BODY_MAX_BYTES, settings } from './env.js';
import { ApiError, fail } from './errors.js';
import { nowMs } from './clock.js';

export type SpaceContext = { id: number; slug: string; name: string; role: Role };

/** What a route works on, looked up before any role or scope check. */
export type ResolvedResource = { streamName?: string; value: unknown };

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  rawBody: Buffer;
  body: Record<string, unknown>;
  caller: Caller;
  space: SpaceContext;
  zone: string;
  resource: ResolvedResource | null;
  setCookie?: string;
};

export type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  handled?: true;
};

export type RouteSpec = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  auth: 'none' | 'session' | 'any';
  space?: boolean;
  role?: Role;
  keyAction?: 'read' | 'upload' | 'manage';
  rate?: 'search' | 'upload' | 'login';
  body?: 'json' | 'upload' | 'ndjson' | 'none';
  resource?: (
    space: SpaceContext,
    params: Record<string, string>,
    url: URL,
  ) => Promise<ResolvedResource | null>;
  handler: (ctx: Ctx) => Promise<Reply>;
};

const routes: RouteSpec[] = [];

export function route(spec: RouteSpec): void {
  routes.push(spec);
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      over = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (over) throw limit === BODY_MAX_BYTES ? fail.bodyTooLarge() : fail.uploadTooLarge();
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

/** The one point every error leaves the server. */
function sendError(res: ServerResponse, cause: unknown): void {
  if (cause instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (cause.retryAfter !== undefined) headers['retry-after'] = String(cause.retryAfter);
    sendJson(res, cause.status, cause.body(), headers);
    return;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(`unhandled: ${message}\n`);
  sendJson(res, 500, { error: 'not_found', message: 'Not found.' });
}

async function resolveCaller(req: IncomingMessage, spec: RouteSpec): Promise<Caller | null> {
  const authorization = req.headers.authorization;
  if (authorization && authorization.startsWith('Bearer ')) {
    const value = authorization.slice('Bearer '.length).trim();
    const key = await keyByValue(value);
    if (!key) throw fail.keyInvalid();
    if (key.revoked) throw fail.keyRevoked();
    if (key.expiresMs !== null && nowMs() >= key.expiresMs) throw fail.keyExpired();
    if (spec.auth === 'session') throw fail.unauthenticated();
    return {
      kind: 'key',
      keyId: key.id,
      spaceId: key.spaceId,
      actions: key.actions,
      pattern: key.pattern,
      name: key.name,
    };
  }
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (!sessionId) return null;
  const user = await userOfSession(sessionId);
  if (!user) return null;
  return { kind: 'session', user, sessionId };
}

async function resolveSpace(caller: Caller, url: URL): Promise<SpaceContext> {
  const requested = url.searchParams.get('space');
  if (caller.kind === 'key') {
    const row = await one(`select id, slug, name from spaces where id = $1`, [caller.spaceId]);
    if (!row) throw fail.notFound();
    if (requested && requested !== String(row.slug)) throw fail.notFound();
    return { id: Number(row.id), slug: String(row.slug), name: String(row.name), role: 'admin' };
  }
  const rows = await one(
    requested
      ? `select s.id, s.slug, s.name, m.role from members m join spaces s on s.id = m.space_id
         where m.user_id = $1 and s.slug = $2`
      : `select s.id, s.slug, s.name, m.role from members m join spaces s on s.id = m.space_id
         where m.user_id = $1 and s.id = (select current_space_id from users where id = $1)`,
    requested ? [caller.user.id, requested] : [caller.user.id],
  );
  if (!rows) throw fail.notFound();
  return {
    id: Number(rows.id),
    slug: String(rows.slug),
    name: String(rows.name),
    role: String(rows.role) as Role,
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

async function serveStatic(publicDir: string, url: URL, res: ServerResponse): Promise<void> {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const candidate = join(publicDir, normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  if (!candidate.startsWith(publicDir)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const info = await stat(candidate);
    if (info.isFile()) {
      res.writeHead(200, {
        'content-type': MIME[extname(candidate)] ?? 'application/octet-stream',
        'cache-control': extname(candidate) === '.html' ? 'no-store' : 'public, max-age=3600',
      });
      createReadStream(candidate).pipe(res);
      return;
    }
  } catch {
    /* an unknown app route falls through to the app shell */
  }
  if (extname(candidate) !== '') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found.');
    return;
  }
  const shell = join(publicDir, 'index.html');
  res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
  createReadStream(shell).pipe(res);
}

export function startServer(publicDir: string): void {
  const server = createServer((req, res) => {
    void handle(req, res, publicDir);
  });
  server.listen(settings.port, '0.0.0.0', () => {
    process.stdout.write(`Spoorline listening on ${settings.port}\n`);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, publicDir: string): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(404).end();
      return;
    }
    await serveStatic(publicDir, url, res);
    return;
  }
  const method = (req.method ?? 'GET').toUpperCase();
  let spec: RouteSpec | null = null;
  let params: Record<string, string> = {};
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const matched = matchPath(candidate.path, url.pathname);
    if (matched) {
      spec = candidate;
      params = matched;
      break;
    }
  }
  if (!spec) {
    sendError(res, fail.notFound());
    return;
  }
  const picked = spec;
  try {
    // 1. body size and kind
    let rawBody = Buffer.alloc(0);
    if (picked.body === 'json') {
      rawBody = await readBody(req, BODY_MAX_BYTES);
    } else if (picked.body === 'upload' || picked.body === 'ndjson') {
      rawBody = await readBody(req, settings.uploadMaxBytes);
      if (picked.body === 'ndjson') {
        const kind = String(req.headers['content-type'] ?? '').split(';')[0].trim();
        if (kind !== 'application/x-ndjson') throw fail.uploadKind();
      }
    } else {
      await readBody(req, BODY_MAX_BYTES);
    }
    let body: Record<string, unknown> = {};
    if (picked.body === 'json' && rawBody.length > 0) {
      try {
        const parsed = JSON.parse(rawBody.toString('utf8')) as unknown;
        body = (parsed ?? {}) as Record<string, unknown>;
      } catch {
        throw fail.invalid({ body: 'Send a JSON object.' });
      }
    }

    // 2. authentication
    const caller = await resolveCaller(req, picked);
    if (picked.auth !== 'none' && !caller) throw fail.unauthenticated();

    // 3. rate limit
    if (picked.rate && caller) {
      const key = caller.kind === 'key' ? caller.keyId : String(caller.user.id);
      countRate(picked.rate, key);
    }

    // 4. the resource, then 5. role and key scope
    let space: SpaceContext = { id: 0, slug: '', name: '', role: 'viewer' };
    let resource: ResolvedResource | null = null;
    if (picked.space && caller) {
      space = await resolveSpace(caller, url);
      if (picked.resource) {
        resource = await picked.resource(space, params, url);
        if (resource === null) throw fail.notFound();
      }
      if (caller.kind === 'session' && picked.role && !roleAllows(space.role, picked.role)) {
        throw fail.forbidden();
      }
      if (caller.kind === 'key') {
        if (!picked.keyAction) throw fail.forbidden();
        const streamName = resource?.streamName;
        if (streamName !== undefined) {
          if (
            !patternMatches(caller.pattern, streamName) ||
            !caller.actions.includes(picked.keyAction)
          ) {
            throw fail.keyScope(picked.keyAction, streamName);
          }
        } else if (!caller.actions.includes(picked.keyAction)) {
          throw fail.keyScope(picked.keyAction, url.searchParams.get('stream') ?? params.stream ?? '');
        }
      }
    }

    const zone = caller?.kind === 'session' ? caller.user.timeZone : 'UTC';
    const ctx: Ctx = {
      req,
      res,
      url,
      params,
      rawBody,
      body,
      caller: caller ?? { kind: 'session', user: { id: 0, username: '', timeZone: 'UTC', currentSpaceId: null }, sessionId: '' },
      space,
      zone,
      resource,
    };
    const reply = await picked.handler(ctx);
    if (reply.handled) return;
    const headers = { ...(reply.headers ?? {}) };
    if (ctx.setCookie) headers['set-cookie'] = ctx.setCookie;
    if (reply.status === 204) {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    sendJson(res, reply.status, reply.body, headers);
  } catch (cause) {
    sendError(res, cause);
  }
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
