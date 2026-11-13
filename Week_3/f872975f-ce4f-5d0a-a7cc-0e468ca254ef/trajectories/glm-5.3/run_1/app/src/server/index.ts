import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { statSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig, newYardId } from './config.js';
import { applySchema, applySeed } from './db/schema.js';
import { Actions } from './db/actions.js';
import { Store, hashPassword } from './db/store.js';
import { S3 } from './services/s3.js';
import { KillBill } from './services/killbill.js';
import { handleApi, type RouteState } from './http/router.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLIENT_DIR = join(__dirname, '../client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const FORBIDDEN_SEGMENTS = new Set([
  'node_modules', 'scripts',
]);
const FORBIDDEN_PREFIXES = ['.env', 'src/', 'dist/'];
const FORBIDDEN_SUFFIXES = ['.ts', '.map', '.json'];
const FORBIDDEN_ROOT_FILES = new Set([
  'run.json', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.client.json',
  'THIRD_PARTY_NOTICES.md',
]);
const ALLOWED_CLIENT_ROOTS = new Set([
  'index.html', 'app.js', 'api.js', 'shell.js', 'svg.js', 'format.js', 'styles.css', 'fonts', 'pages',
]);

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl });

  // PostgreSQL is required: retry until it answers.
  for (;;) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (error) {
      console.error('waiting for database', error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  await applySchema(pool);
  await applySeed(pool, hashPassword, newYardId());

  const storage = new S3(config.s3);
  const killbill = new KillBill(config.killbill);
  void storage.ensureBucket().catch((error) => console.error('bucket create failed', error));

  const store = new Store(pool);
  const actions = new Actions(pool);
  const state: RouteState = {
    store,
    actions,
    holdSeconds: config.holdSeconds,
    killbill,
    storage: { put: (k, b, c) => storage.put(k, b, c), get: (k) => storage.get(k), delete: (k) => storage.delete(k), ping: () => storage.ping() },
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await handle(state, req, res);
    } catch (error) {
      console.error('server error', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'not_found', message: 'Something went wrong. Try again.' }));
    }
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`kerfwell rack serving on 0.0.0.0:${config.port}`);
  });
}

async function handle(state: RouteState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = decodeURI(url.pathname);
  const origin = req.headers.origin ?? null;

  if (pathname.startsWith('/api/')) {
    const cookieHeader = req.headers.cookie ?? '';
    const token = readSessionToken(cookieHeader);
    const user = token ? await state.store.sessionUser(token) : null;
    await handleApi(state, req, res, methodOf(req), pathname, url.searchParams, token, user, origin);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }
  serveClient(pathname, res);
}

function methodOf(req: IncomingMessage): string {
  return (req.method ?? 'GET').toUpperCase();
}

function readSessionToken(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'kerfwell_session' && rest.length > 0) {
      return rest.join('=');
    }
  }
  return null;
}

function serveClient(pathname: string, res: ServerResponse): void {
  // Only the built client assets are served; every other path falls back to the SPA index.
  const clean = normalize(pathname).replace(/^\/+/, '');
  const firstSegment = clean.split('/')[0] ?? '';
  const forbidden =
    clean !== '' &&
    (FORBIDDEN_ROOT_FILES.has(clean) ||
      FORBIDDEN_SEGMENTS.has(firstSegment) ||
      FORBIDDEN_PREFIXES.some((prefix) => clean.startsWith(prefix)) ||
      FORBIDDEN_SUFFIXES.some((suffix) => clean.endsWith(suffix)));
  if (forbidden) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  if (clean !== '' && ALLOWED_CLIENT_ROOTS.has(firstSegment) && existsSync(join(CLIENT_DIR, clean)) && !assetIsDirectory(join(CLIENT_DIR, clean))) {
    const body = readFileSync(join(CLIENT_DIR, clean));
    res.writeHead(200, {
      'Content-Type': MIME[extname(clean)] ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': clean.startsWith('fonts/') ? 'public, max-age=86400' : 'no-store',
    });
    res.end(body);
    return;
  }
  const index = readFileSync(join(CLIENT_DIR, 'index.html'));
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(index.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(index);
}

function assetIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error('fatal', error);
  process.exit(1);
});
