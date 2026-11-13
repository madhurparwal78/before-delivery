import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, sendJson } from './errors.js';
import { handleApi } from './api.js';
import { GOTENBERG } from './services/gotenberg.js';
import { MINIO } from './services/minio.js';
import { VALKEY } from './services/valkey.js';
import { db, hubs } from './routes.js';
import { seedIfMissing } from './seed.js';
import { presenceSweeper, attachWebSockets, startPingLoop } from './livesession.js';
import { startPdfRetryLoop } from './parts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../client');

const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const NEVER_SERVED = new Set(['/run.json', '/package.json', '/package-lock.json', '/tsconfig.json', '/.env']);

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    void dispatch(req, res).catch((err: unknown) => {
      if (!res.headersSent) console.error('request failed:', err);
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof ApiError) {
        err.write(res);
        return;
      }
      new ApiError(500, 'internal', 'Something went wrong on the server.').write(res);
    });
  });
}

async function dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = (req.method ?? 'GET').toUpperCase();

  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, url, method, pathname);
    return;
  }

  if (NEVER_SERVED.has(pathname) || pathname.startsWith('/src') || pathname.startsWith('/node_modules') || pathname === '/build.mjs' || pathname === '/tsconfig.json') {
    sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    return;
  }

  await serveStatic(pathname, res);
}

async function serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.normalize(path.join(DIST, filePath));
  if (!resolved.startsWith(DIST)) {
    sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    return;
  }
  let target = resolved;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    // client-side routes fall back to the shell
    target = path.join(DIST, 'index.html');
    if (!fs.existsSync(target)) {
      sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
      return;
    }
  }
  const ext = path.extname(target).toLowerCase();
  const body = fs.readFileSync(target);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(body);
}

async function main(): Promise<void> {
  GOTENBERG.configure(process.env.GOTENBERG_URL ?? '');
  void MINIO.ensureBucket();
  void VALKEY.connect();
  const ok = await db.healthy();
  if (!ok) {
    console.error('Postgres is unreachable at boot; the server will keep retrying.');
  }
  await seedIfMissing();
  presenceSweeper.start();
  startPingLoop();
  startPdfRetryLoop();

  VALKEY.onLiveChange((live) => {
    for (const hub of hubs.values()) {
      void hub.broadcast({ type: 'live', live });
    }
  });

  const server = createServer();
  attachWebSockets(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Fairline listening on 0.0.0.0:${PORT}`);
  });
}

void main();
