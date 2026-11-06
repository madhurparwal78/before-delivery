/** The HTTP boundary: routing, same-origin and body-limit enforcement, JSON replies and the static client. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { User } from '../shared/types.js';
import { currentUser } from './auth.js';
import { requireDatabase } from './db.js';
import { HttpError, fail, isRecord, logError } from './errors.js';

const BODY_LIMIT = 65536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Reply { status: number; body?: unknown; headers?: Record<string, string> }

interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  user: User;
  /** The parsed JSON object body (an empty body is `{}`). */
  json(): Promise<Record<string, unknown>>;
  /** The raw body bytes, within the body limit. */
  raw(): Promise<Buffer>;
  header(name: string): string | undefined;
}

type Auth = 'none' | 'user' | 'fitter';
type Handler = (ctx: Ctx) => Promise<Reply>;
interface Route { method: string; pattern: RegExp; names: string[]; auth: Auth; handler: Handler; exemptOrigin: boolean }

const routes: Route[] = [];

export function route(method: string, path: string, auth: Auth, handler: Handler, options: { exemptOrigin?: boolean } = {}): void {
  const names: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, name: string) => { names.push(name); return '([^/]+)'; })}$`);
  routes.push({ method, pattern, names, auth, handler, exemptOrigin: options.exemptOrigin ?? false });
}

/** A path parameter that must be a UUID; anything else is the same not-found as a missing row. */
export function uuidParam(value: string | undefined): string {
  if (!value || !UUID.test(value)) throw fail(404, 'not_found');
  return value.toLowerCase();
}

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      over = true;
      chunks.length = 0;
      if (size > BODY_LIMIT * 64 || (Number.isFinite(declared) && declared > BODY_LIMIT * 64)) break;
      continue;
    }
    chunks.push(chunk);
  }
  if (over) throw fail(413, 'payload_too_large');
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (status === 204) {
    res.writeHead(204, { 'Cache-Control': 'no-store', ...headers });
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
  });
  res.end(payload);
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers['origin'];
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers['host'];
  } catch {
    return false;
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png',
};
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const PAGE = /^\/(configure|bikes(\/[^/]+)?|rides(\/[^/]+)?|orders(\/[^/]+)?|sign-in|register|desk(\/orders\/[^/]+)?)?$/;

/** A malformed percent-escape names nothing, the same as any unknown address. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    throw fail(404, 'not_found');
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  const clean = normalize(decoded(pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, clean);
  if (file.startsWith(PUBLIC_DIR) && clean !== '/' && extname(clean)) {
    try {
      const bytes = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': bytes.length,
        'Cache-Control': clean.startsWith('/assets/') || clean.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
      return;
    } catch {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
  }
  const html = await readFile(join(PUBLIC_DIR, 'index.html'));
  res.writeHead(PAGE.test(pathname) ? 200 : 404, {
    'Content-Type': TYPES['.html'], 'Content-Length': html.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : html);
}


async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  try {
    if (!url.pathname.startsWith('/api/')) {
      await serveStatic(req, res, url.pathname);
      return;
    }
    const found = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
    if (!found) throw fail(404, 'not_found');
    if (method !== 'GET' && method !== 'HEAD' && !found.exemptOrigin && !sameOrigin(req)) throw fail(403, 'cross_origin');
    if (url.pathname !== '/api/health') await requireDatabase();
    const captured = found.pattern.exec(url.pathname)?.slice(1) ?? [];
    const params: Record<string, string> = {};
    found.names.forEach((name, i) => { params[name] = decoded(captured[i]); });
    let user: User | null = null;
    if (found.auth !== 'none') {
      user = await currentUser(req);
      if (!user) throw fail(401, 'unauthenticated');
      if (found.auth === 'fitter' && user.role !== 'fitter') throw fail(403, 'forbidden');
    }
    let body: Promise<Buffer> | null = null;
    const raw = (): Promise<Buffer> => (body ??= readBody(req));
    const ctx: Ctx = {
      req, params, query: url.searchParams,
      get user(): User {
        if (!user) throw fail(401, 'unauthenticated');
        return user;
      },
      raw,
      async json() {
        const bytes = await raw();
        if (bytes.length === 0) return {};
        let parsed: unknown;
        try {
          parsed = JSON.parse(bytes.toString('utf8'));
        } catch {
          throw fail(400, 'bad_request');
        }
        if (!isRecord(parsed)) throw fail(400, 'bad_request');
        return parsed;
      },
      header: (name) => {
        const value = req.headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
      },
    };
    if (method !== 'GET' && method !== 'HEAD') await raw();
    const reply = await found.handler(ctx);
    sendJson(res, reply.status, reply.body, reply.headers);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, error.body);
    } else {
      logError(error);
      sendJson(res, 500, { error: 'internal_error' });
    }
  }
}

export function startServer(port: number): Server {
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      logError(error);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
      else res.end();
    });
  });
  server.keepAliveTimeout = 65000;
  server.listen(port, '0.0.0.0');
  return server;
}
