import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { config } from './config';
import { applySchema, waitForDatabase } from './db/pool';
import { seedIfEmpty } from './db/seed';
import {
  AppError,
  crossOrigin,
  methodNotAllowed,
  notFound,
  tooLargeRequest,
  unsupportedMediaType
} from './errors';
import { parseMultipart, readBody } from './http/body';
import { Ctx, parseCookies, resolveSession, sessionCookie } from './http/context';
import { sendHtml, sendJson } from './http/respond';
import { findRoute } from './http/router';
import { registerAccountRoutes } from './api/accounts';
import { registerAdminRoutes } from './api/admin';
import { registerCartRoutes } from './api/cart';
import { registerCaseRoutes } from './api/cases';
import { registerCatalogueRoutes } from './api/catalogue';
import { registerCheckoutRoutes } from './api/checkout';
import { registerGradingRoutes } from './api/grading';
import { registerLiveRoutes } from './api/live';
import { registerOrderRoutes } from './api/orders';
import { registerViewRoutes } from './views/index';
import { startHoldSweeper } from './domain/holds';
import { startMailWorker } from './domain/notify';
import { queueAllProducts, startIndexer } from './services/indexer';
import { startLivePump } from './services/live';
import { ensureBucket } from './services/storage';
import { errorPage } from './views/layout';

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

const ASSET_ROOTS: Array<{ prefix: string; dir: string }> = [
  { prefix: '/assets/client/', dir: join(__dirname, '..', 'client') },
  { prefix: '/assets/fonts/', dir: join(__dirname, '..', '..', 'public', 'fonts') },
  { prefix: '/assets/', dir: join(__dirname, '..', '..', 'public') }
];

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml'
};

function serveAsset(ctx: Ctx): boolean {
  for (const root of ASSET_ROOTS) {
    if (!ctx.pathname.startsWith(root.prefix)) continue;
    const relative = normalize(ctx.pathname.slice(root.prefix.length));
    if (relative.startsWith('..') || relative.includes('\0')) return false;
    const file = join(root.dir, relative);
    if (!existsSync(file) || !statSync(file).isFile()) return false;
    const type = CONTENT_TYPES[extname(file)];
    if (type === undefined) return false;
    ctx.response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': String(statSync(file).size),
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    if (ctx.method === 'HEAD') {
      ctx.response.end();
      return true;
    }
    createReadStream(file).pipe(ctx.response);
    return true;
  }
  return false;
}

function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  try {
    return new URL(origin).origin === new URL(config.publicUrl).origin;
  } catch {
    return false;
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', config.publicUrl);
  const cookies = parseCookies(request.headers.cookie);
  const method = (request.method ?? 'GET').toUpperCase();

  const ctx: Ctx = {
    request,
    response,
    method,
    pathname: url.pathname,
    query: url.searchParams,
    params: {},
    sessionId: '',
    user: null,
    raw: Buffer.alloc(0),
    body: {},
    multipart: null,
    cookies,
    setCookies: []
  };

  const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/');

  try {
    if (serveAsset(ctx)) return;

    const session = await resolveSession(cookies.rh_session);
    ctx.sessionId = session.sessionId;
    ctx.user = session.user;
    if (session.fresh) ctx.setCookies.push(sessionCookie(session.sessionId));

    const { match, pathKnown } = findRoute(method, url.pathname);
    if (match === null) {
      if (pathKnown) throw methodNotAllowed(url.pathname.startsWith('/api/admin/audit/'));
      throw notFound();
    }
    ctx.params = match.params;

    const kind = match.route.kind;
    if (WRITE_METHODS.includes(method)) {
      const contentType = String(request.headers['content-type'] ?? '');
      const limit = kind === 'upload' ? config.uploadMaxBytes + 100000 : config.jsonMaxBytes;
      const result = await readBody(request, limit);
      if (result.tooLarge) throw tooLargeRequest();
      ctx.raw = result.body;

      if (kind === 'upload') {
        if (!contentType.toLowerCase().startsWith('multipart/form-data')) throw unsupportedMediaType();
      } else if (ctx.raw.length > 0 && !contentType.toLowerCase().startsWith('application/json')) {
        throw unsupportedMediaType();
      }
      if (!originAllowed(request)) throw crossOrigin();

      if (kind === 'upload') {
        ctx.multipart = parseMultipart(ctx.raw, contentType);
      } else if (ctx.raw.length > 0) {
        try {
          const parsed = JSON.parse(ctx.raw.toString('utf8'));
          ctx.body = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        } catch {
          throw unsupportedMediaType();
        }
      }
    }

    await match.route.handler(ctx);
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof AppError) {
      if (isApi || error.status !== 404) {
        sendJson(ctx, error.status, error.body);
      } else {
        sendHtml(ctx, 404, errorPage(ctx, 'notFound'));
      }
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    if (isApi) {
      sendJson(ctx, 500, { error: 'internal_error', message: 'Something went wrong on our side. Try again.' });
    } else {
      sendHtml(ctx, 500, errorPage(ctx, 'server'));
    }
  }
}

function registerRoutes(): void {
  registerCatalogueRoutes();
  registerAccountRoutes();
  registerCartRoutes();
  registerCheckoutRoutes();
  registerOrderRoutes();
  registerCaseRoutes();
  registerAdminRoutes();
  registerLiveRoutes();
  registerGradingRoutes();
  registerViewRoutes();
}

async function boot(): Promise<void> {
  await waitForDatabase(60000);
  await applySchema();
  await seedIfEmpty();
  await ensureBucket();
  await queueAllProducts();

  registerRoutes();
  startIndexer();
  startLivePump();
  startHoldSweeper();
  startMailWorker();

  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Roam House Atelier listening on ${config.port}\n`);
  });
}

void boot().catch((error: unknown) => {
  process.stderr.write(`startup failed: ${String(error)}\n`);
  process.exit(1);
});
