import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { applySchema } from './db.js';
import { ApiError, internal, methodNotAllowed, notFound } from './http/errors.js';
import { REVIEW_HEADERS, sendEmpty, sendError, sendJson } from './http/respond.js';
import { dispatch, type Route } from './http/router.js';
import { serveAsset, serveDocument } from './http/static.js';
import { authRoutes } from './routes/auth.js';
import { checkpointRoutes } from './routes/checkpoints.js';
import { fileRoutes } from './routes/files.js';
import { importRoutes } from './routes/imports.js';
import { projectRoutes } from './routes/projects.js';
import { reviewerRoutes } from './routes/reviewer.js';
import { sessionRoutes } from './routes/sessions.js';
import { attachProjectSocket, clearInstancePresence } from './socket.js';
import { retryPendingCheckpoints } from './services/checkpointUpload.js';
import { sweepExpiredPlans } from './services/imports.js';
import { flushQueuedMail } from './services/mail.js';
import { ensureBucket } from './services/storage.js';

const healthRoute: Route = {
  method: 'GET',
  pattern: '/api/health',
  scope: 'public',
  body: 'none',
  handler: async () => ({ status: 200, payload: { status: 'ok' } }),
};

const routes: readonly Route[] = [
  healthRoute,
  ...authRoutes,
  ...projectRoutes,
  ...sessionRoutes,
  ...fileRoutes,
  ...checkpointRoutes,
  ...importRoutes,
  ...reviewerRoutes,
];

const APP_PAGES = [/^\/$/, /^\/sign-in$/, /^\/auth\/verify$/, /^\/projects\/[^/]+$/];

const isAppPage = (pathname: string) => APP_PAGES.some((page) => page.test(pathname));

const isReviewPath = (pathname: string) =>
  pathname.startsWith('/review/') || pathname.startsWith('/api/review/');

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const ownOrigin = `http://${req.headers.host ?? 'localhost'}`;
  const extraHeaders = isReviewPath(url.pathname) ? REVIEW_HEADERS : {};

  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (url.pathname.startsWith('/review/')) throw methodNotAllowed();
        throw notFound();
      }
      if (url.pathname.startsWith('/assets/')) {
        const served = await serveAsset(res, url.pathname.slice(1));
        if (served) return;
        throw notFound();
      }
      if (url.pathname.startsWith('/review/')) {
        await serveDocument(res, 'review.html', REVIEW_HEADERS);
        return;
      }
      if (!isAppPage(url.pathname)) throw notFound();
      await serveDocument(res, 'index.html');
      return;
    }

    const reply = await dispatch(routes, req, res, url, ownOrigin);
    const headers = { ...extraHeaders, ...(reply.headers ?? {}) };
    if (reply.payload === undefined) sendEmpty(res, reply.status, headers);
    else sendJson(res, reply.status, reply.payload, headers);
  } catch (cause) {
    if (cause instanceof ApiError) {
      sendError(res, cause, extraHeaders);
      return;
    }
    sendError(res, internal(), extraHeaders);
  }
}

function everyFewSeconds(seconds: number, run: () => Promise<void>): void {
  const tick = (): void => {
    run()
      .catch(() => undefined)
      .finally(() => setTimeout(tick, seconds * 1000).unref());
  };
  setTimeout(tick, seconds * 1000).unref();
}

async function main(): Promise<void> {
  await applySchema();
  await clearInstancePresence();
  await ensureBucket().catch(() => undefined);

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  attachProjectSocket(server);

  everyFewSeconds(3, retryPendingCheckpoints);
  everyFewSeconds(3, sweepExpiredPlans);
  everyFewSeconds(5, flushQueuedMail);

  server.listen(config.port, '0.0.0.0');
}

await main();
