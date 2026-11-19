import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './config.js';
import { loadClock } from './clock.js';
import { waitForDatabase } from './db.js';
import { unauthorized } from './errors.js';
import { jsonLimitFor, readBody, resolveCaller, sendError, sendText, type Ctx } from './http.js';
import { startOutboxWorker } from './mail.js';
import { startScheduler } from './scheduler.js';
import { startStorageProbe } from './storage.js';
import { handleApi } from './api/index.js';
import { handlePage, registerFragmentRenderer } from './pages/index.js';
import { seed } from './seed.js';

const STATIC_ROOT = new URL('../../public/', import.meta.url).pathname;

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

async function serveStatic(pathname: string, response: ServerResponse): Promise<boolean> {
  const relative = normalize(pathname.replace(/^\/(assets|fonts)\//, ''));
  if (relative.startsWith('..')) return false;
  const folder = pathname.startsWith('/fonts/') ? 'fonts' : 'assets';
  try {
    const file = await readFile(join(STATIC_ROOT, folder, relative));
    sendText(response, 200, file, CONTENT_TYPES[extname(relative)] ?? 'application/octet-stream');
    return true;
  } catch {
    return false;
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const method = request.method ?? 'GET';

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {
    if (await serveStatic(url.pathname, response)) return;
    response.writeHead(404).end();
    return;
  }

  const { caller, badToken } = await resolveCaller(request);
  const rawBody =
    method === 'POST' || method === 'PUT' || method === 'DELETE'
      ? await readBody(request, jsonLimitFor(url.pathname))
      : null;

  const ctx: Ctx = { request, response, url, method, segments, caller, rawBody, parsedBody: null };

  if (segments[0] === 'api') {
    try {
      if (badToken) throw unauthorized();
      await handleApi(ctx);
    } catch (error) {
      sendError(response, error);
    }
    return;
  }

  try {
    await handlePage(ctx);
  } catch (error) {
    sendError(response, error);
  }
}

/** Seeding needs storage, so it is retried while storage is still coming up. */
async function seedWhenReady(): Promise<void> {
  for (;;) {
    try {
      await seed();
      return;
    } catch (error) {
      console.error('[ridgestack] seed deferred:', (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function start(): Promise<void> {
  registerFragmentRenderer();
  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      sendError(response, error);
    });
  });
  server.requestTimeout = 0;
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[ridgestack] listening on ${config.port}`);
  });

  await waitForDatabase();
  await loadClock();
  startStorageProbe();
  await seedWhenReady();
  startScheduler();
  startOutboxWorker();
}

void start().catch((error) => {
  console.error('[ridgestack] failed to start', error);
  process.exit(1);
});
