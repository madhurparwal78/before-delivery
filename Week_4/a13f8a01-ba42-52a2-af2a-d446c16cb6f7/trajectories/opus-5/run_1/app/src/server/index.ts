import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config';
import { applySchema, one } from './db';
import { findPen, visibleTo } from './domain/pens';
import { parseCookies, SESSION_COOKIE, userForSession } from './auth';
import { keepAlive } from './events';
import { ApiError, notFound } from './errors';
import { buildContext, errorReply, Router, sendReply, type Reply } from './http';
import { flushOutbox } from './mail';
import { appPage, embedPage, notFoundPage, staticFile } from './pages';
import { registerAuthRoutes } from './routes/auth';
import { registerCollectionRoutes } from './routes/collections';
import { registerGradingRoutes } from './routes/grading';
import { cleanUpRenders, registerMiscRoutes } from './routes/misc';
import { registerPenRoutes } from './routes/pens';
import { seedRelational, seedStorage } from './seed';

const router = new Router();
registerAuthRoutes(router);
registerPenRoutes(router);
registerCollectionRoutes(router);
registerMiscRoutes(router);
if (config.grading) registerGradingRoutes(router);

const PAGE_PATHS = new Set([
  '/',
  '/signup',
  '/signin',
  '/verify',
  '/dashboard',
  '/explore',
  '/collections',
  '/shelf',
]);

const PEN_ID = /^[a-z0-9]{10}$/;

const viewerFor = async (request: IncomingMessage): Promise<string | null> => {
  const cookies = parseCookies(request.headers.cookie);
  const user = await userForSession(cookies[SESSION_COOKIE] ?? null);
  return user?.id ?? null;
};

const pageReply = async (request: IncomingMessage, pathname: string): Promise<Reply> => {
  if (PAGE_PATHS.has(pathname)) return appPage();

  const parts = pathname.split('/').filter((part) => part.length > 0);

  if (parts[0] === 'pen' && PEN_ID.test(parts[1] ?? '') && (parts.length === 2 || parts[2] === 'history')) {
    if (parts.length > 3) return notFoundPage();
    const pen = await findPen(parts[1]!);
    return pen && visibleTo(pen, await viewerFor(request)) ? appPage() : notFoundPage();
  }

  if (parts[0] === 'embed' && parts.length === 2 && PEN_ID.test(parts[1] ?? '')) {
    const pen = await findPen(parts[1]!);
    return pen && visibleTo(pen, await viewerFor(request)) ? embedPage() : notFoundPage();
  }

  if (parts[0] === 'collections' && parts.length === 2) {
    const viewerId = await viewerFor(request);
    const collection = viewerId
      ? await one<{ id: string }>('select id from collections where id = $1 and owner_id = $2', [
          parts[1]!,
          viewerId,
        ])
      : null;
    return collection ? appPage() : notFoundPage();
  }

  return notFoundPage();
};

const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;
  const method = request.method ?? 'GET';

  if (pathname.startsWith('/public/')) {
    sendReply(response, staticFile(pathname) ?? notFoundPage());
    return;
  }

  const isApi = pathname.startsWith('/api/');
  const isAsset = pathname.startsWith('/preview/') || pathname.startsWith('/shelf/');

  if (isApi || isAsset) {
    try {
      const found = router.match(method, pathname);
      if (!found) throw notFound();
      const ctx = await buildContext(request, response, url, found.params);
      sendReply(response, await found.route.handler(ctx));
    } catch (error) {
      // Preview documents and shelf files are not JSON, so their misses answer in plain text.
      if (!isApi && error instanceof ApiError && error.code === 'not_found') {
        sendReply(response, { status: 404, raw: 'Nothing here.', contentType: 'text/plain; charset=utf-8' });
        return;
      }
      sendReply(response, errorReply(error));
    }
    return;
  }

  try {
    sendReply(response, await pageReply(request, pathname));
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    sendReply(response, notFoundPage());
  }
};

const server = createServer((request, response) => {
  void handle(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});

const waitFor = async (task: () => Promise<void>, attempts: number): Promise<void> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await task();
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};

const start = async (): Promise<void> => {
  await waitFor(applySchema, 30);
  await waitFor(seedRelational, 10);

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`ashlar listening on ${config.port}\n`);
  });

  const tryStorageSeed = async (): Promise<void> => {
    try {
      await seedStorage();
    } catch {
      // Storage is unreachable; the next pass tries afresh.
    }
  };
  void tryStorageSeed();
  setInterval(() => void tryStorageSeed(), 30000);
  setInterval(() => void flushOutbox(), 10000);
  setInterval(() => keepAlive(), 20000);
  setInterval(() => void cleanUpRenders(), 600000);
};

void start();
