import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { clientConfig, config } from './config.js';
import { waitForDatabase } from './db.js';
import { ApiError, apiErrors } from './errors.js';
import { RequestContext, Router, isCrossOrigin, readCookie, sendError } from './http.js';
import { handleLiveUpgrade } from './live.js';
import { startSearchIndexing } from './search.js';
import { startSnapshotConfirmation } from './snapshots.js';
import { storageHealthy } from './storage.js';
import { sessionUser } from './store.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerRecipeRoutes } from './routes/recipes.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerTeamRoutes } from './routes/teams.js';
import { registerImportRoutes } from './routes/imports.js';
import { registerGradingRoutes } from './routes/grading.js';

const router = new Router();

router.add(
  'GET',
  '/api/health',
  async (ctx) => {
    ctx.json(200, { status: (await storageHealthy()) ? 'ok' : 'unavailable' });
  },
  true,
);

router.add(
  'GET',
  '/api/config',
  (ctx) => {
    ctx.json(200, clientConfig());
  },
  true,
);

registerAuthRoutes(router);
registerRecipeRoutes(router);
registerAssetRoutes(router);
registerTeamRoutes(router);
registerImportRoutes(router);
if (config.gradingEnabled) registerGradingRoutes(router);

const publicDir = resolve(import.meta.dirname, 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const ASSET_FILES = new Set(['/app.js', '/worker.js', '/styles.css']);

const PAGE_PATHS = [
  /^\/$/,
  /^\/w$/,
  /^\/library$/,
  /^\/library\/[^/]+$/,
  /^\/import$/,
  /^\/team$/,
  /^\/signup$/,
  /^\/signin$/,
  /^\/verify\/[^/]+$/,
  /^\/invite\/[^/]+$/,
  /^\/s\/[^/]+$/,
];

async function serveFile(response: ServerResponse, filePath: string, pathname: string): Promise<void> {
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': pathname.startsWith('/fonts/') ? 'public, max-age=86400' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers['host'] ?? 'localhost'}`);
  const pathname = url.pathname;
  const method = request.method ?? 'GET';

  if (pathname.startsWith('/api/')) {
    if ((method === 'POST' || method === 'DELETE') && isCrossOrigin(request)) {
      sendError(response, apiErrors.crossOrigin());
      return;
    }
    const matched = router.match(method, pathname);
    if (matched === null) {
      sendError(response, apiErrors.notFound());
      return;
    }
    const ctx = new RequestContext(request, response, url, matched.params);
    try {
      const token = readCookie(request, 'wb_session');
      if (token !== null) {
        const user = await sessionUser(token);
        if (user !== null) {
          ctx.session = { userId: user.id, displayName: user.displayName, email: user.email };
        }
      }
      if (matched.route.open !== true && ctx.session === null) throw apiErrors.unauthenticated();
      await matched.route.handler(ctx);
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (!response.headersSent) sendError(response, cause);
        return;
      }
      console.error('request failed', cause);
      if (!response.headersSent) {
        sendError(response, new ApiError(500, 'server_error', 'Something went wrong.'));
      }
    }
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Method not allowed');
    return;
  }

  if (ASSET_FILES.has(pathname)) {
    await serveFile(response, join(publicDir, pathname.slice(1)), pathname);
    return;
  }
  if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(pathname)) {
    await serveFile(response, join(publicDir, pathname.slice(1)), pathname);
    return;
  }
  if (PAGE_PATHS.some((pattern) => pattern.test(pathname))) {
    await serveFile(response, join(publicDir, 'index.html'), pathname);
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

async function main(): Promise<void> {
  await waitForDatabase();
  startSearchIndexing();
  startSnapshotConfirmation();

  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/api/live') {
      socket.destroy();
      return;
    }
    void handleLiveUpgrade(request, socket, head);
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Wringbench is serving on port ${config.port}`);
  });
}

await main();
