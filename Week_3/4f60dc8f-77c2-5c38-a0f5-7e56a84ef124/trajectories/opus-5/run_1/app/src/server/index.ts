import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { AppError } from './http/app-error.js';
import {
  checkCrossOrigin,
  closeAfterResponse,
  matchRoute,
  sendError,
  sendHtml,
  sendJson,
  type Ctx,
  type Route,
} from './http/kernel.js';
import { ensureSchema } from './db/pool.js';
import { publicRoutes } from './routes/public.js';
import { clientRoutes } from './routes/client.js';
import { reviewRoutes } from './routes/review.js';
import { studioRoutes } from './routes/studio.js';
import { pageRoutes } from './routes/pages.js';
import { notFoundPage } from './views/pages.js';
import { seedPocketBase, seedPostgres, seedSearch } from './app/seed.js';
import { startOutboxWorker } from './app/outbox-worker.js';
import { startDelayedJobRetry, startMeasurementWorker } from './app/measure.js';
import { settleOverdue } from './app/billing.js';
import { ensureCollections } from './services/pocketbase.js';
import { ensureIndex } from './services/search.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

const apiRoutes: Route[] = [...publicRoutes, ...clientRoutes, ...reviewRoutes, ...studioRoutes];

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const ALLOWED_STATIC = /^\/(app\.js|app\.css|fonts\/[a-zA-Z0-9._-]+\.woff2)$/;

const serveStatic = async (ctx: Ctx): Promise<boolean> => {
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return false;
  if (!ALLOWED_STATIC.test(ctx.url.pathname)) return false;
  const path = normalize(join(publicDir, ctx.url.pathname));
  if (!path.startsWith(publicDir)) return false;
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    size = info.size;
  } catch {
    return false;
  }
  const extension = ctx.url.pathname.slice(ctx.url.pathname.lastIndexOf('.'));
  ctx.response.writeHead(200, {
    'Content-Type': STATIC_TYPES[extension] ?? 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (ctx.method === 'HEAD') {
    ctx.response.end();
    return true;
  }
  await pipeline(createReadStream(path), ctx.response);
  return true;
};

const wantsJson = (ctx: Ctx): boolean =>
  ctx.url.pathname.startsWith('/api/') ||
  (ctx.request.headers.accept ?? '').includes('application/json');

const respondNotFound = (ctx: Ctx): void => {
  if (wantsJson(ctx)) {
    sendError(ctx, new AppError('not_found'));
    return;
  }
  sendHtml(ctx, 404, notFoundPage());
};

const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const ctx: Ctx = {
    request,
    response,
    method: request.method ?? 'GET',
    url,
    params: {},
  };

  try {
    if (url.pathname === '/api/health') {
      sendJson(ctx, 200, { status: 'ok' });
      return;
    }

    checkCrossOrigin(ctx);
    await ensureSchema();

    if (await serveStatic(ctx)) return;

    const api = matchRoute(apiRoutes, ctx.method, url.pathname);
    if (api !== null) {
      ctx.params = api.params;
      await api.handler(ctx);
      return;
    }

    const page = matchRoute(pageRoutes, ctx.method === 'HEAD' ? 'GET' : ctx.method, url.pathname);
    if (page !== null) {
      ctx.params = page.params;
      await page.handler(ctx);
      return;
    }

    respondNotFound(ctx);
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof AppError) {
      closeAfterResponse(ctx);
      if (error.code === 'not_found') {
        respondNotFound(ctx);
        return;
      }
      sendError(ctx, error);
      return;
    }
    process.stderr.write(
      `request failed ${ctx.method} ${ctx.url.pathname}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    sendJson(ctx, 500, { error: 'not_found', message: "We couldn't find that page" });
  } finally {
    if (!response.writableEnded && !response.headersSent) response.end();
  }
};

const server = createServer((request, response) => {
  void handle(request, response);
});

server.headersTimeout = 120_000;
server.requestTimeout = 0;

const boot = async (): Promise<boolean> => {
  const steps: { name: string; run: () => Promise<void> }[] = [
    { name: 'schema', run: ensureSchema },
    { name: 'postgres seeds', run: seedPostgres },
    { name: 'pocketbase collections', run: ensureCollections },
    { name: 'pocketbase seeds', run: seedPocketBase },
    { name: 'search index', run: ensureIndex },
    { name: 'search seeds', run: seedSearch },
  ];
  let complete = true;
  for (const step of steps)
    try {
      await step.run();
    } catch (error) {
      complete = false;
      process.stderr.write(`boot step ${step.name} deferred: ${String(error)}\n`);
    }
  return complete;
};

let booted = false;

const bootUntilComplete = (): void => {
  if (booted) return;
  void boot()
    .then((complete) => {
      booted = complete;
    })
    .catch(() => undefined);
};

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`gloamwork shot rig listening on ${config.port}\n`);
  bootUntilComplete();
  startOutboxWorker();
  startMeasurementWorker();
  startDelayedJobRetry();
  setInterval(() => {
    void settleOverdue(null).catch(() => undefined);
  }, 10_000).unref();
  setInterval(bootUntilComplete, 10_000).unref();
});
