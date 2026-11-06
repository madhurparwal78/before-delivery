import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './config.ts';
import { applySchema } from './db/schema.ts';
import { applySeed } from './db/seed.ts';
import { pool } from './db/pool.ts';
import { startListening } from './events.ts';
import { ApiError } from './http/errors.ts';
import { Ctx, type RouteResult } from './http/context.ts';
import { runApi, useRoutes } from './http/pipeline.ts';
import { allRoutes } from './routes/index.ts';
import { startWorkers } from './workers.ts';

const PUBLIC_DIR = join(import.meta.dirname, 'public');

const SPA_PATHS = new Set([
  '/',
  '/signin',
  '/pieces',
  '/pieces/new',
  '/credit',
  '/intake',
  '/planner',
  '/dashboard',
  '/rates',
  '/members',
  '/reports',
  '/settings',
]);

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

let ready = false;

function isSpaPath(path: string): boolean {
  if (SPA_PATHS.has(path)) return true;
  const parts = path.split('/');
  if (parts.length !== 3) return false;
  if (parts[1] === 'pieces' && parts[2] !== '' && parts[2] !== 'new') return true;
  return parts[1] === 'invite' && parts[2] !== '';
}

function isStaticPath(path: string): boolean {
  return path === '/fonts.css' || path.startsWith('/assets/') || path.startsWith('/fonts/');
}

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: Buffer | string,
  extra: Record<string, string> = {},
): void {
  const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': buffer.byteLength,
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(buffer);
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  if (status === 204) {
    res.writeHead(204, { 'cache-control': 'no-store', ...extra });
    res.end();
    return;
  }
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body ?? null), extra);
}

function applyResult(res: ServerResponse, result: RouteResult): void {
  const extra: Record<string, string> = {};
  if (result.setSession) extra['set-cookie'] = result.setSession;
  if (result.raw) {
    send(res, result.status, result.raw.contentType, result.raw.buffer, {
      ...extra,
      ...(result.raw.headers ?? {}),
    });
    return;
  }
  sendJson(res, result.status, result.body, extra);
}

async function serveStatic(res: ServerResponse, path: string): Promise<void> {
  const resolved = normalize(join(PUBLIC_DIR, path));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendJson(res, 404, { error: 'not_found', message: 'That record does not exist.' });
    return;
  }
  try {
    const body = await readFile(resolved);
    const type = STATIC_TYPES[extname(resolved)] ?? 'application/octet-stream';
    const cache = path.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-store';
    send(res, 200, type, body, { 'cache-control': cache });
  } catch {
    sendJson(res, 404, { error: 'not_found', message: 'That record does not exist.' });
  }
}

async function serveIndex(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(join(PUBLIC_DIR, 'index.html'));
    send(res, 200, 'text/html; charset=utf-8', html);
  } catch {
    sendJson(res, 503, { status: 'starting' });
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (path === '/api/health') {
    if (ready) sendJson(res, 200, { status: 'ok' });
    else sendJson(res, 503, { status: 'starting' });
    return;
  }

  if (path.startsWith('/api/')) {
    const ctx = new Ctx(req, res, path, url.searchParams);
    try {
      const result = await runApi(ctx);
      if (!result.streamed) applyResult(res, result);
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status, error.body());
        return;
      }
      process.stderr.write(`request failed: ${String(error)}\n`);
      sendJson(res, 500, {
        error: 'server_error',
        message: 'Something went wrong. Try again.',
      });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 404, { error: 'not_found', message: 'That record does not exist.' });
    return;
  }
  if (isStaticPath(path)) {
    await serveStatic(res, path);
    return;
  }
  if (isSpaPath(path)) {
    await serveIndex(res);
    return;
  }
  sendJson(res, 404, { error: 'not_found', message: 'That record does not exist.' });
}

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

async function boot(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await applySeed();
  await startListening();
  startWorkers();
  ready = true;
}

useRoutes(allRoutes);

const server = createServer({ maxHeaderSize: 65_536 }, (req, res) => {
  void handle(req, res).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { error: 'server_error', message: 'Something went wrong. Try again.' });
  });
});
server.listen(config.port, '0.0.0.0');

void boot().catch((error) => {
  process.stderr.write(`boot failed: ${String(error)}\n`);
  setTimeout(() => void boot(), 2_000);
});
