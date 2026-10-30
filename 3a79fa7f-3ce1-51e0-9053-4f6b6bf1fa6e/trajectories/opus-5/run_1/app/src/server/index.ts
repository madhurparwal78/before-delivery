import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearClock, nowIso, setClock, startClockSync, syncClock } from './clock.js';
import { config } from './config.js';
import { pool } from './db.js';
import { ApiError, fail } from './errors.js';
import {
  Router,
  isJsonReply,
  parseCookies,
  parseJsonBody,
  readRawBody,
  sendApiError,
  sendJson,
  type Ctx,
  type Access,
} from './http.js';
import { SESSION_COOKIE, loadSession, requireCustomer, requireSession, requireStaff } from './auth.js';
import { matchPage, pageHtml } from './pages.js';
import { migrateAndSeed } from './schema.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCartRoutes } from './routes/cart.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerDemoRoutes } from './routes/demo.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerStaffRoutes } from './routes/staff.js';
import { registerSupportRoutes } from './routes/support.js';
import { registerTradeInRoutes } from './routes/tradeins.js';
import { startOutboxWorker } from './services/outbox.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');
const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

let ready = false;

const router = new Router();
router.add('GET', '/api/health', 'anyone', async () => ({ status: 'ok' }));
if (config.clockControl) {
  router.add('PUT', '/api/_clock', 'anyone', async (ctx) => {
    const value = ctx.body.now;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
      fail('validation_error', { fields: { now: 'Send an ISO 8601 UTC time ending in Z.' } });
    }
    const target = new Date(value);
    if (Number.isNaN(target.getTime())) fail('validation_error', { fields: { now: 'Send an ISO 8601 UTC time ending in Z.' } });
    await setClock(target);
    return { now: nowIso() };
  });
  router.add('DELETE', '/api/_clock', 'anyone', async () => {
    await clearClock();
    return { now: nowIso() };
  });
}
registerAuthRoutes(router);
registerCatalogRoutes(router);
registerCartRoutes(router);
registerOrderRoutes(router);
registerTradeInRoutes(router);
registerDemoRoutes(router);
registerSupportRoutes(router);
registerStaffRoutes(router);

function applyAccess(access: Access, ctx: Ctx): void {
  if (access === 'anyone') return;
  if (access === 'signed-in') requireSession(ctx);
  else if (access === 'customer') requireCustomer(ctx);
  else requireStaff(ctx, access);
}

function makeCtx(req: IncomingMessage, res: ServerResponse, url: URL): Ctx {
  const cookies = parseCookies(req.headers.cookie);
  const pending: string[] = [];
  const flush = (): void => {
    if (pending.length > 0) res.setHeader('Set-Cookie', pending);
  };
  return {
    req,
    res,
    method: req.method ?? 'GET',
    url,
    params: {},
    body: {},
    rawBody: '',
    cookies,
    session: null,
    setCookie(name, value, maxAgeSeconds) {
      const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
      if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
      pending.push(parts.join('; '));
      cookies[name] = value;
      flush();
    },
    clearCookie(name) {
      pending.push(`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      delete cookies[name];
      flush();
    },
  };
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const ctx = makeCtx(req, res, url);
  try {
    const segments = url.pathname.split('/').filter((s) => s.length > 0);
    const { entry, params } = router.match(ctx.method, segments);
    ctx.params = params;
    ctx.rawBody = await readRawBody(req);
    ctx.body = parseJsonBody(ctx.rawBody, req.headers['content-type']);
    ctx.session = await loadSession(ctx.cookies[SESSION_COOKIE]);
    applyAccess(entry.access, ctx);

    const result = await entry.handler(ctx);
    if (isJsonReply(result)) sendJson(res, result.status, result.body, result.headers ?? {});
    else sendJson(res, 200, result ?? {});
  } catch (error) {
    req.resume();
    if (error instanceof ApiError) {
      if (error.status === 413) res.setHeader('Connection', 'close');
      sendApiError(res, error);
    }
    else {
      process.stderr.write(`request failed: ${String(error)}\n`);
      sendApiError(res, new ApiError('internal_error'));
    }
  }
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const filePath = join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const extension = filePath.slice(filePath.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': MIME[extension] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': extension === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (res.req.method === 'HEAD') {
      res.end();
      return true;
    }
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
    return true;
  } catch {
    return false;
  }
}

function sendPage(res: ServerResponse, route: string, status: number, extraHeaders: Record<string, string> = {}): void {
  const html = pageHtml(route);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    ...extraHeaders,
  });
  res.end(res.req.method === 'HEAD' ? undefined : html);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;

  void (async () => {
    if (pathname === '/api/health' || pathname.startsWith('/api/')) {
      if (pathname === '/api/health' && !ready) {
        sendJson(res, 503, { status: 'starting' });
        return;
      }
      if (!ready) {
        sendJson(res, 503, { error: 'internal_error', message: 'Something went wrong.' });
        return;
      }
      await handleApi(req, res, new URL(pathname + url.search, url.origin));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendPage(res, 'not-found', 404);
      return;
    }

    if (await serveStatic(res, pathname)) return;

    const route = matchPage(pathname);
    if (!route) {
      sendPage(res, 'not-found', 404);
      return;
    }
    const headers: Record<string, string> =
      route === 'cart-shared'
        ? { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
        : {};
    sendPage(res, route, 200, headers);
  })().catch((error) => {
    process.stderr.write(`response failed: ${String(error)}\n`);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal_error', message: 'Something went wrong.' });
    else res.end();
  });
});

async function boot(): Promise<void> {
  for (;;) {
    try {
      await migrateAndSeed();
      await syncClock();
      ready = true;
      return;
    } catch (error) {
      process.stderr.write(`waiting for PostgreSQL: ${String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

server.listen(config.appPublicPort, '0.0.0.0', () => {
  process.stdout.write(`Tern Foils listening on 0.0.0.0:${config.appPublicPort}\n`);
});

void boot().then(() => {
  startClockSync();
  startOutboxWorker();
});

process.on('SIGTERM', () => {
  server.close(() => void pool.end());
});
