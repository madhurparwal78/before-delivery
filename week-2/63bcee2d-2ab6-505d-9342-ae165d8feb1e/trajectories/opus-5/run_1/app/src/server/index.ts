import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema, waitForPostgres } from './db/migrate.js';
import { applySeed, restoreSeedFiles } from './db/seed.js';
import { buildRouter } from './routes/index.js';
import { serveApi } from './http/router.js';
import { pageStatus, tenderTitleForLink } from './http/pages.js';
import { ensureBucket } from './services/storage.js';
import { startMailDelivery } from './services/mail.js';

const CLIENT_ROOT = fileURLToPath(new URL('../client/', import.meta.url));

const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/vnd.microsoft.icon',
};

let ready = false;
const router = buildRouter();

async function readShell(): Promise<Buffer> {
  return readFile(join(CLIENT_ROOT, 'index.html'));
}

/**
 * The tender sign-in page shows the tender's name without using the link, so the
 * name travels with the page rather than through a request the page would make.
 */
async function shellFor(pathname: string): Promise<Buffer> {
  const match = /^\/tender-sign-in\/([A-Za-z0-9_-]{8,128})$/.exec(pathname);
  const shell = await readShell();
  if (!match) return shell;
  const title = await tenderTitleForLink(match[1] as string);
  if (title === null) return shell;
  const meta = `<meta name="plumbline:tender-title" content="${escapeAttribute(title)}" />`;
  return Buffer.from(shell.toString('utf8').replace('</head>', `  ${meta}\n  </head>`), 'utf8');
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Built browser assets only: nothing outside dist/client/assets is served. */
async function serveAsset(pathname: string, response: ServerResponse): Promise<boolean> {
  const relative = normalize(pathname).replace(/^\/+/, '');
  if (!relative.startsWith('assets/') || relative.includes('..')) return false;
  const file = join(CLIENT_ROOT, relative);
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const bytes = await readFile(file);
    response.writeHead(200, {
      'Content-Type': ASSET_CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(bytes);
    return true;
  } catch {
    return false;
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/health') {
    const body = ready ? { status: 'ok' } : { status: 'starting' };
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    response.writeHead(ready ? 200 : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(payload.byteLength),
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(payload);
    return;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
    await serveApi(router, request, response, url);
    return;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    if (await serveAsset(url.pathname, response)) return;
    const status = ready ? await pageStatus(url.pathname) : 503;
    const shell = ready ? await shellFor(url.pathname) : await readShell();
    response.writeHead(status === 503 ? 503 : status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(shell.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : shell);
    return;
  }

  response.writeHead(404, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify({ error: 'not_found' }));
}

const server = createServer((request, response) => {
  handle(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});

server.listen(config.port, '0.0.0.0');

async function boot(): Promise<void> {
  await waitForPostgres(() => undefined);
  await applySchema();
  const seedFiles = await applySeed();
  ready = true;
  startMailDelivery();
  try {
    await ensureBucket();
    await restoreSeedFiles(seedFiles);
  } catch {
    // The bucket is unreachable; uploads and downloads report the outage and the
    // seeded files are rewritten on a later start.
  }
}

void boot();
