import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema } from './db.js';
import { applySeed } from './seed.js';
import { Ctx, sendError } from './http.js';
import { AppError, notFound } from './errors.js';
import { attachSession } from './session.js';
import { renderPage } from './pages.js';
import { notFoundPage } from './render/public.js';
import { dispatch, Route } from './routes/router.js';
import { authRoutes } from './routes/auth.js';
import { customerRoutes } from './routes/customers.js';
import { publicRoutes } from './routes/public.js';
import { enquiryRoutes } from './routes/enquiries.js';
import { operatorRoutes } from './routes/operators.js';
import { bidRoutes } from './routes/bids.js';
import { quoteRoutes } from './routes/quotes.js';
import { paymentRoutes } from './routes/payments.js';
import { runRoutes } from './routes/runs.js';
import { seatRoutes } from './routes/seats.js';
import { changeRoutes } from './routes/changes.js';
import { documentRoutes } from './routes/documents.js';
import { aftercareRoutes } from './routes/aftercare.js';
import { ensureBucket } from './providers/storage.js';
import { startWorkers } from './workers.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(here, '..', 'public');

const ROUTES: Route[] = [
  ...authRoutes,
  ...publicRoutes,
  ...customerRoutes,
  ...enquiryRoutes,
  ...operatorRoutes,
  ...bidRoutes,
  ...quoteRoutes,
  ...paymentRoutes,
  ...runRoutes,
  ...seatRoutes,
  ...changeRoutes,
  ...documentRoutes,
  ...aftercareRoutes,
].sort((left, right) => countParams(left.pattern) - countParams(right.pattern));

function countParams(pattern: string): number {
  return pattern.split('/').filter((part) => part.startsWith(':')).length;
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function serveFile(ctx: Ctx): boolean {
  if (ctx.method !== 'GET') return false;
  const wanted = normalize(ctx.path).replace(/^(\.\.[/\\])+/, '');
  if (wanted === '/' || wanted === '') return false;
  const file = join(publicDirectory, wanted);
  if (!file.startsWith(publicDirectory) || !existsSync(file) || !statSync(file).isFile()) return false;
  const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
  const size = statSync(file).size;
  ctx.response.writeHead(200, {
    'content-type': type,
    'content-length': String(size),
    'cache-control': extname(file) === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(wanted === '/service-worker.js' ? { 'service-worker-allowed': '/' } : {}),
  });
  createReadStream(file).pipe(ctx.response);
  return true;
}

async function handle(ctx: Ctx): Promise<void> {
  await attachSession(ctx);
  const isApi = ctx.path === '/api' || ctx.path.startsWith('/api/');
  if (isApi) {
    const answered = await dispatch(ROUTES, ctx);
    if (!answered) throw notFound();
    return;
  }
  if (serveFile(ctx)) return;
  if (await renderPage(ctx)) return;
  ctx.html(404, notFoundPage());
}

async function start(): Promise<void> {
  await applySchema();
  await applySeed();
  void ensureBucket().catch(() => undefined);
  startWorkers();

  const server = createServer((request, response) => {
    const ctx = new Ctx(request, response);
    handle(ctx).catch((trouble) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (ctx.path.startsWith('/api/') || trouble instanceof AppError === false) {
        sendError(ctx, trouble);
        return;
      }
      const known = trouble as AppError;
      if (known.status === 404) {
        ctx.html(404, notFoundPage());
        return;
      }
      sendError(ctx, trouble);
    });
  });
  server.listen(config.publicPort, '0.0.0.0', () => {
    console.log(`Wayticket is listening on ${config.publicPort}`);
  });
}

void start();
