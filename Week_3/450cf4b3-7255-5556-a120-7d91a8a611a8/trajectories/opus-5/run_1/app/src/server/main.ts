import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { config } from './config';
import { applySchema } from './db';
import { applySeed } from './seed';
import { startMailWorker } from './mail-worker';
import { startSweeps } from './domain/notices';
import { accountRoutes } from './routes/accounts';
import { bookingRoutes } from './routes/bookings';
import { documentRoutes } from './routes/documents';
import { doorRoutes } from './routes/door';
import { floorRoutes } from './routes/floor';
import { ownerRoutes } from './routes/owner';
import { packRoutes } from './routes/packs';
import { runApiRequest, sendBytes, sendJson } from './http/pipeline';
import { SECURITY_HEADERS } from './http/security';
import { notFound } from './http/errors';
import type { Route } from './http/route';

const routes: ReadonlyArray<Route> = [
  ...accountRoutes,
  ...floorRoutes,
  ...bookingRoutes,
  ...doorRoutes,
  ...packRoutes,
  ...documentRoutes,
  ...ownerRoutes,
];

const PUBLIC_DIR = join(__dirname, '..', 'public');

const SCREEN_PATHS: ReadonlyArray<RegExp> = [
  /^\/$/,
  /^\/signin$/,
  /^\/apply$/,
  /^\/board$/,
  /^\/packs$/,
  /^\/documents$/,
  /^\/tenants$/,
  /^\/tenants\/[^/]+$/,
  /^\/report$/,
  /^\/receipt\/[^/]+$/,
];

const ASSETS: ReadonlyMap<string, string> = new Map([
  ['/app.js', 'application/javascript; charset=utf-8'],
  ['/app.css', 'text/css; charset=utf-8'],
]);

async function serveAsset(response: ServerResponse, path: string, contentType: string): Promise<void> {
  const resolved = normalize(join(PUBLIC_DIR, path));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendBytes(response, 404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' }, Buffer.from('Not found'));
    return;
  }
  try {
    const bytes = await readFile(resolved);
    sendBytes(
      response,
      200,
      { ...SECURITY_HEADERS, 'content-type': contentType, 'cache-control': 'no-cache' },
      bytes,
    );
  } catch {
    sendBytes(
      response,
      404,
      { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
      Buffer.from('Not found'),
    );
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const host = request.headers.host ?? `127.0.0.1:${config.port}`;
  const url = new URL(request.url ?? '/', `http://${host}`);
  const path = url.pathname;

  if (path.startsWith('/api/')) {
    await runApiRequest(routes, request, response, url);
    return;
  }

  const method = (request.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(response, 404, notFound().body());
    return;
  }

  const asset = ASSETS.get(path);
  if (asset !== undefined) {
    await serveAsset(response, path, asset);
    return;
  }
  if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(path)) {
    await serveAsset(response, path, 'font/woff2');
    return;
  }
  if (SCREEN_PATHS.some((pattern) => pattern.test(path))) {
    await serveAsset(response, '/index.html', 'text/html; charset=utf-8');
    return;
  }
  sendBytes(
    response,
    404,
    { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
    Buffer.from('Not found'),
  );
}

async function start(): Promise<void> {
  await applySchema();
  await applySeed();

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'internal_error', message: 'Something went wrong on our side.' });
      } else {
        response.end();
      }
    });
  });
  server.requestTimeout = 30_000;
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`stationhouse listening on ${config.port}\n`);
  });

  startMailWorker();
  startSweeps();
}

void start().catch((error: unknown) => {
  process.stderr.write(`failed to start: ${String(error)}\n`);
  process.exit(1);
});
