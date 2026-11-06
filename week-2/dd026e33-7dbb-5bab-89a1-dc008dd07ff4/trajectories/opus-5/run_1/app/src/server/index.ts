import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { config } from './config';
import { pool, query } from './db';
import { SCHEMA_SQL } from './schema';
import { seedIfEmpty } from './seed';
import { handleApiRequest } from './http/pipeline';
import { registerRoutes } from './routes';
import { startQueueWorker } from './queue';

const CLIENT_ROOT = resolve(import.meta.dirname, '../client');
const INDEX_FILE = join(CLIENT_ROOT, 'index.html');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(path: string, response: ServerResponse): Promise<boolean> {
  const target = resolve(join(CLIENT_ROOT, normalize(path)));
  if (!target.startsWith(CLIENT_ROOT)) return false;
  try {
    const stats = await stat(target);
    if (!stats.isFile()) return false;
    const bytes = await readFile(target);
    const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream';
    response.writeHead(200, {
      'content-type': type,
      'content-length': String(bytes.length),
      'x-content-type-options': 'nosniff',
      'cache-control': target.includes(`${join(CLIENT_ROOT, 'assets')}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    response.end(bytes);
    return true;
  } catch {
    return false;
  }
}

async function serveApp(response: ServerResponse): Promise<void> {
  const html = await readFile(INDEX_FILE);
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(html.length),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
  });
  response.end(html);
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (path === '/api' || path.startsWith('/api/')) {
    await handleApiRequest(request, response, path, url.searchParams);
    return;
  }

  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  if (path !== '/' && (await serveStatic(path, response))) return;
  await serveApp(response);
}

async function applySchema(): Promise<void> {
  await query(SCHEMA_SQL);
}

async function boot(): Promise<void> {
  registerRoutes();
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      process.stderr.write(`unhandled request error: ${String(error)}\n`);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'server_error' }));
      } else {
        response.end();
      }
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Lacquer is listening on ${String(config.port)}\n`);
  });

  await applySchema();
  await seedIfEmpty();
  startQueueWorker();
}

process.on('SIGTERM', () => {
  void pool.end().then(() => process.exit(0));
});

void boot().catch((error: unknown) => {
  process.stderr.write(`boot failed: ${String(error)}\n`);
  process.exit(1);
});
