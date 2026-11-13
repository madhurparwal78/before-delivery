// The desk's HTTP server: serves the pages, the assets and the API from one origin.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Pool } from 'pg';
import { loadConfig, type DeskConfig } from './config.js';
import { applySchema } from './db.js';
import { Store, RecordsUnavailable } from './store.js';
import { KillBillClient, BillingUnavailable } from './services/killbill.js';
import { StorageClient, StorageUnavailable } from './services/storage.js';
import { MailClient, MailUnavailable } from './services/mail.js';
import { CarrierClient } from './services/carrier.js';
import { apiError, type ApiError } from './errors.js';
import { parseInstant, londonDateOf } from './clock.js';
import { json, sendError, parseCookies, readBody, type Ctx, type Handler } from './http.js';
import { registerPublicRoutes } from './api/public.js';
import { registerOperatorRoutes } from './api/operator.js';
import { startNoticePump } from './api/notices.js';

export interface Desk {
  config: DeskConfig;
  pool: Pool;
  store: Store;
  killbill: KillBillClient;
  storage: StorageClient;
  mail: MailClient;
  carrier: CarrierClient;
  now(): number;
}

export function newReference(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i]! % alphabet.length];
  return `HG-${out}`;
}

export function newToken(length = 43): string {
  return randomBytes(32).toString('base64url').slice(0, Math.max(32, length));
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(`holmgarth:${password}`).digest('hex');
}

export function verifyPassword(password: string, hash: string): boolean {
  const a = Buffer.from(hashPassword(password), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function serviceError(e: unknown, isOperatorRoute: boolean): ApiError {
  if (e instanceof RecordsUnavailable) {
    return isOperatorRoute
      ? apiError({ status: 503, code: 'database_unavailable', message: "The claim records aren't answering. Nothing was changed." })
      : apiError({ status: 503, code: 'database_unavailable', message: "We can't reach our claim records right now, so nothing was saved. Please try again in a few minutes." });
  }
  if (e instanceof StorageUnavailable) {
    return isOperatorRoute
      ? apiError({ status: 503, code: 'storage_unavailable', message: "File storage isn't answering. Nothing was changed." })
      : apiError({ status: 503, code: 'storage_unavailable', message: "We can't store photos right now, so nothing was saved. Please try again in a few minutes." });
  }
  if (e instanceof MailUnavailable) {
    return isOperatorRoute
      ? apiError({ status: 503, code: 'mail_unavailable', message: "Email isn't answering. Nothing was erased." })
      : apiError({ status: 503, code: 'mail_unavailable', message: "We can't send email right now, so nothing was saved. Please try again in a few minutes." });
  }
  if (e instanceof BillingUnavailable) {
    return isOperatorRoute
      ? apiError({ status: 503, code: 'billing_unavailable', message: "Billing isn't answering. Nothing was charged or changed." })
      : apiError({ status: 503, code: 'billing_unavailable', message: "Billing isn't answering right now. Please try again in a few minutes." });
  }
  return apiError({ status: 500, code: 'internal', message: 'Request failed.' });
}

const JSON_BODY_LIMIT = 64_000;
const CLAIM_BODY_LIMIT = 33_000_000;
const IMPORT_BODY_LIMIT = 2_000_000;

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const FORBIDDEN_PREFIXES = ['/src/', '/node_modules/', '/.', '/run.json', '/package.json', '/package-lock.json', '/tsconfig.json', '/build.mjs'];

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: Handler;
  needsSession: boolean;
  jsonBody: boolean;
  bodyLimit: number;
  claimPrefix: 'public' | 'operator';
}

export class Router {
  routes: Route[] = [];

  add(method: string, template: string, handler: Handler, opts?: { session?: boolean; raw?: boolean; limit?: number }): void {
    const names: string[] = [];
    const source = template.replace(/\{(\w+)\}/g, (_, name: string) => {
      names.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${source}$`),
      names,
      handler,
      needsSession: opts?.session ?? false,
      jsonBody: !(opts?.raw ?? false),
      bodyLimit: opts?.limit ?? JSON_BODY_LIMIT,
      claimPrefix: template.startsWith('/api/ops/') ? 'operator' : 'public',
    });
  }
}

function readStatic(dir: string, name: string): Buffer | null {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  const st = statSync(path);
  if (!st.isFile()) return null;
  return readFileSync(path);
}

function safeJoin(root: string, candidate: string): string | null {
  const resolved = join(root, candidate);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3000,
  });
  pool.on('error', () => { /* keep the process alive */ });

  let frozenAt: number | null = null;
  if (config.deskClockFrozenAt) {
    const parsed = parseInstant(config.deskClockFrozenAt);
    if (parsed !== null) frozenAt = parsed;
  }
  const now = (): number => (frozenAt !== null ? frozenAt : Date.now());

  const desk: Desk = {
    config,
    pool,
    store: new Store(pool, config),
    killbill: new KillBillClient(config),
    storage: new StorageClient(config),
    mail: new MailClient(config),
    carrier: new CarrierClient(config.wiremockUrl),
    now,
  };

  const router = new Router();
  registerPublicRoutes(router, desk);
  registerOperatorRoutes(router, desk);

  // Apply the schema as soon as Postgres answers; keep trying in the background.
  const trySchema = () => {
    applySchema(pool, config).then(() => { schemaReady = true; }).catch(() => { schemaReady = false; });
  };
  let schemaReady = false;
  trySchema();
  const schemaTimer = setInterval(() => {
    if (!schemaReady) trySchema();
  }, 5000);
  schemaTimer.unref();

  startNoticePump(desk);

  const distDir = join(process.cwd(), 'dist');
  const assetsDir = join(distDir, 'assets');

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await handleRequest(desk, router, req, res, distDir, assetsDir, () => schemaReady);
    } catch (e) {
      sendError(res, apiError({ status: 500, code: 'internal', message: 'Request failed.' }));
    }
  });

  server.listen(config.appPublicPort, '0.0.0.0');
  console.log(`fittings-desk listening on 0.0.0.0:${config.appPublicPort}`);
}

async function handleRequest(
  desk: Desk, router: Router, req: IncomingMessage, res: ServerResponse,
  distDir: string, assetsDir: string, schemaReady: () => boolean,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://internal');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/health') {
    json(res, 200, { status: 'ok' });
    return;
  }

  // Never serve source, manifests or environment files.
  if (method === 'GET' || method === 'HEAD') {
    const lower = path.toLowerCase();
    if (FORBIDDEN_PREFIXES.some((p) => lower.startsWith(p)) || lower === '/package.json' || lower === '/run.json') {
      notFoundPage(res, distDir);
      return;
    }
    if (!path.startsWith('/api/')) {
      await serveStatic(path, res, distDir, assetsDir);
      return;
    }
  }

  // API routes.
  for (const route of router.routes) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1] ?? ''); });

    const origin = req.headers.origin ?? null;
    const host = req.headers.host ?? '';
    const isSameOrigin = origin === null || origin === `http://${host}` || origin === `https://${host}`;

    const cookies = parseCookies(req.headers.cookie);
    const ctx: Ctx = {
      req, res, method, path, query: url.searchParams, params,
      body: undefined, rawBody: Buffer.alloc(0), origin,
      callerAddress: req.socket.remoteAddress ?? '',
      cookies, setCookies: [],
    };

    // Precedence 2: 415 wrong type, 413 too large.
    const contentTypeHeader = req.headers['content-type'];
    const contentTypeParts = (contentTypeHeader ?? '').split(';');
    const contentType = (contentTypeParts[0] ?? '').trim().toLowerCase();
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      if (contentType === '' && !route.jsonBody) {
        // No body expected; continue.
      } else if (route.jsonBody && contentType !== 'application/json') {
        const length = Number(req.headers['content-length'] ?? '0');
        if (contentType !== '' || length !== 0) {
          sendError(res, apiError({ status: 415, code: 'unsupported_media_type', message: 'Send JSON.' }));
          return;
        }
      }
    }

    const raw = await readBody(req, route.bodyLimit);
    if (raw === null) {
      const code = path === '/api/claims' ? 'request_too_large'
        : path === '/api/ops/imports' ? 'file_too_large' : 'request_too_large';
      if (path === '/api/ops/imports') {
        sendError(res, apiError({ status: 413, code, message: 'The file is larger than 2,000,000 bytes.' }));
      } else if (path === '/api/claims') {
        sendError(res, apiError({ status: 413, code, message: 'Those photos are too large to send together.' }));
      } else {
        sendError(res, apiError({ status: 413, code, message: 'That request body is too large.' }));
      }
      return;
    }
    ctx.rawBody = raw;
    if (raw.length > route.bodyLimit) {
      sendError(res, apiError({ status: 413, code: 'request_too_large', message: 'That request body is too large.' }));
      return;
    }
    if (route.jsonBody && raw.length > 0) {
      try {
        ctx.body = JSON.parse(raw.toString('utf8'));
      } catch {
        sendError(res, apiError({ status: 400, code: 'bad_json', message: 'Send JSON.' }));
        return;
      }
    }

    // Precedence 3: 403 cross_origin for state-changing requests.
    if (method !== 'GET' && method !== 'HEAD' && !isSameOrigin) {
      sendError(res, apiError({ status: 403, code: 'cross_origin', message: 'Cross-origin requests are not accepted.' }));
      return;
    }

    // Precedence 4: 401 unauthenticated for operator endpoints.
    if (route.needsSession) {
      const session = await readSession(desk, cookies);
      if (session === null) {
        sendError(res, apiError({ status: 401, code: 'unauthenticated', message: 'Sign in to continue.' }));
        return;
      }
      (ctx as Ctx & { sessionId?: string }).sessionId = session;
    }

    try {
      await route.handler(ctx);
    } catch (e) {
      if (e instanceof ApiErrorSignal) {
        sendError(res, e.error);
        return;
      }
      console.error('request failed', method, path, e);
      sendError(res, serviceError(e, route.claimPrefix === 'operator'));
      return;
    }
    return;
  }

  json(res, 404, { error: { code: 'not_found', message: 'No such endpoint.' } });
}

async function serveStatic(path: string, res: ServerResponse, distDir: string, assetsDir: string): Promise<void> {
  if (path === '/' || path === '' || !path.includes('.')) {
    const html = readStatic(distDir, 'index.html');
    if (html) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
  }
  const name = path.replace(/^\//, '');
  const file = safeJoin(distDir, name) ?? '';
  if (file.startsWith(distDir)) {
    const body = readStatic(distDir, name);
    if (body !== null) {
      const type = MIME[extname(name)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
      return;
    }
    const asset = safeJoin(assetsDir, name.replace('assets/', ''));
    if (asset && asset.startsWith(assetsDir)) {
      const body = readStatic(assetsDir, name.replace('assets/', ''));
      if (body !== null) {
        const type = MIME[extname(name)] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(body);
        return;
      }
    }
  }
  notFoundPage(res, distDir);
}

function notFoundPage(res: ServerResponse, distDir: string): void {
  const html = readStatic(distDir, 'index.html');
  if (html) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

export async function readSession(desk: Desk, cookies: Record<string, string>): Promise<string | null> {
  const token = cookies['ops_session'];
  if (!token) return null;
  try {
    const res = await desk.store.query<{ token: string; expires_at: Date }>(
      'SELECT token, expires_at FROM sessions WHERE token = $1', [token],
    );
    const row = res.rows[0];
    if (!row) return null;
    if (row.expires_at.getTime() <= desk.now()) return null;
    return row.token;
  } catch {
    return null;
  }
}

/** Thrown by handlers to answer with a published error. */
export class ApiErrorSignal extends Error {
  constructor(public readonly error: ApiError) {
    super(error.code);
    this.name = 'ApiErrorSignal';
  }
}

export function throwApi(error: ApiError): never {
  throw new ApiErrorSignal(error);
}

startServer().catch((e) => {
  console.error('failed to start the desk', e);
  process.exitCode = 1;
});

