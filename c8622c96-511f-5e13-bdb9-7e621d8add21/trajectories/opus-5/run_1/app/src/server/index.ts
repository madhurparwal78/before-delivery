import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_PATHS } from '../domain/sections.js';
import { config } from './config.js';
import { applySchemaAndSeed } from './db/seed.js';
import { personBySession } from './data/people.js';
import { ApiError, forbidden, notFound, unauthenticated } from './http/errors.js';
import {
  buildContext,
  crossOrigin,
  fileTooLarge,
  isStateChanging,
  JSON_BODY_LIMIT,
  matchRoute,
  payloadTooLarge,
  readBody,
  sendReply,
  unsupportedMediaType,
  UPLOAD_BODY_LIMIT,
  type Route,
} from './http/router.js';
import { browseRoutes } from './routes/browse.js';
import { deskRoutes } from './routes/desk.js';
import { licenceRoutes } from './routes/licences.js';
import { sessionRoutes } from './routes/session.js';
import { studioRoutes } from './routes/studio.js';
import { treasuryRoutes } from './routes/treasury.js';
import { usageRoutes } from './routes/usage.js';
import { startWorkers } from './workers.js';

const routes: Route[] = [
  ...sessionRoutes,
  ...studioRoutes,
  ...browseRoutes,
  ...licenceRoutes,
  ...usageRoutes,
  ...deskRoutes,
  ...treasuryRoutes,
];

const clientRoot = fileURLToPath(new URL('../../client/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return true;
  const host = req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendReply(res, { status: 404, body: 'Not found', contentType: 'text/plain; charset=utf-8' });
    return;
  }
  const indexPath = join(clientRoot, 'index.html');
  if (APP_PATHS.includes(path) && existsSync(indexPath)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    createReadStream(indexPath).pipe(res);
    return;
  }
  const relative = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(clientRoot, relative);
  if (!filePath.startsWith(clientRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendReply(res, { status: 404, body: 'Not found', contentType: 'text/plain; charset=utf-8' });
    return;
  }
  const headers: Record<string, string> = {
    'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    'cache-control': relative.startsWith('assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-store',
  };
  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  route: Route,
  params: Record<string, string>,
  url: URL,
): Promise<void> {
  const limit = route.upload ? UPLOAD_BODY_LIMIT : JSON_BODY_LIMIT;
  const rawBody = await readBody(req, limit, route.upload ? fileTooLarge() : payloadTooLarge());
  const contentType = (req.headers['content-type'] ?? '').toLowerCase();
  if (rawBody.length > 0) {
    if (route.upload) {
      if (!contentType.includes('multipart/form-data')) throw unsupportedMediaType();
    } else if (!contentType.includes('application/json')) {
      throw unsupportedMediaType();
    }
  }
  if (isStateChanging(req.method ?? 'GET') && !sameOrigin(req)) throw crossOrigin();
  const ctx = buildContext(req, url.pathname, url.searchParams, params, rawBody);
  if (!route.anonymous && ctx.sessionId) ctx.person = await personBySession(ctx.sessionId);
  if (route.roles) {
    if (!ctx.person) throw unauthenticated();
    if (!route.roles.includes(ctx.person.role)) throw forbidden();
  }
  sendReply(res, await route.handle(ctx));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const match = matchRoute(routes, req.method ?? 'GET', path);
  if (!match) {
    if (path.startsWith('/api') || path.startsWith('/media')) {
      sendReply(res, { status: 404, json: notFound().body() });
      return;
    }
    serveStatic(req, res, path);
    return;
  }
  void handleApi(req, res, match.route, match.params, url).catch((error: unknown) => {
    if (error instanceof ApiError) {
      sendReply(res, { status: error.status, json: error.body() });
      return;
    }
    console.error('request failed', error);
    sendReply(res, {
      status: 500,
      json: { error: { code: 'internal_error', message: 'Saltprint Desk hit an unexpected error.' } },
    });
  });
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`saltprint desk listening on ${config.port}`);
});

async function boot(): Promise<void> {
  for (;;) {
    try {
      await applySchemaAndSeed();
      return;
    } catch (error) {
      console.error('database not ready yet', error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

void boot().then(() => {
  startWorkers();
});
