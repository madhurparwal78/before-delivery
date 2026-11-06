import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter, RATE_LIMITED_WRITES } from './api/index.ts';
import { config, LIMITS } from './config.ts';
import { applySchema } from './db/schema.ts';
import { applySeed } from './db/seed.ts';
import { waitForDatabase } from './db/pool.ts';
import { Ctx, readBody } from './http/context.ts';
import { ApiError, crossOrigin, methodNotAllowed, notFound } from './http/errors.ts';
import { sendApiError, sendText } from './http/respond.ts';
import { countWaitlistJoin } from './repo/ratelimit.ts';
import { startSweep } from './sweep.ts';
import { renderPage } from './views/pages.ts';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#101726"/><circle cx="16" cy="16" r="10" fill="none" stroke="#e8e3da" stroke-width="2"/><line x1="16" y1="16" x2="16" y2="7" stroke="#c2411f" stroke-width="2.5" stroke-linecap="round"/></svg>`;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MULTIPART_PATHS = [/^\/api\/drops\/[^/]+\/looks$/, /^\/api\/drops\/[^/]+\/line-sheet\/import$/];

async function serveAsset(ctx: Ctx): Promise<boolean> {
  const name = ctx.path.slice('/assets/'.length);
  if (name === 'favicon.svg') {
    sendText(ctx.response, 200, 'image/svg+xml', FAVICON, { 'cache-control': 'public, max-age=3600' });
    return true;
  }
  const relative = normalize(name);
  if (relative.startsWith('..') || relative.startsWith('/')) return false;
  const contentType = CONTENT_TYPES[extname(relative)];
  if (contentType === undefined) return false;
  try {
    const bytes = await readFile(join(PUBLIC_DIR, relative));
    sendText(ctx.response, 200, contentType, bytes, { 'cache-control': 'public, max-age=3600' });
    return true;
  } catch {
    return false;
  }
}

function isMultipartPath(path: string): boolean {
  return MULTIPART_PATHS.some((pattern) => pattern.test(path));
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const host = request.headers.host ?? `127.0.0.1:${config.port}`;
  const url = new URL(request.url ?? '/', `http://${host}`);
  const method = (request.method ?? 'GET').toUpperCase();
  const streamed = isMultipartPath(url.pathname);
  const body = streamed
    ? { bytes: Buffer.alloc(0), overLimit: false }
    : await readBody(request, LIMITS.jsonBodyBytes);
  const ctx = new Ctx(request, response, url, body, Date.now());

  if (url.pathname.startsWith('/assets/')) {
    if (await serveAsset(ctx)) return;
    sendText(response, 404, 'text/plain; charset=utf-8', 'Not found');
    return;
  }

  const isApiPath = url.pathname.startsWith('/api/') || url.pathname === '/sitemap.xml';
  const match = apiRouter.match(url.pathname, method);

  if (match === null && isApiPath) {
    sendApiError(response, notFound());
    return;
  }

  if (match !== null) {
    try {
      if (match.handler === null) throw methodNotAllowed(match.allow);
      if (WRITE_METHODS.has(method)) requireOwnOrigin(ctx);
      if (
        RATE_LIMITED_WRITES.some((entry) => entry.method === method && entry.pattern.test(url.pathname))
      ) {
        await countWaitlistJoin(ctx.clientKey, ctx.nowMs);
      }
      ctx.params = match.params;
      await match.handler(ctx);
    } catch (error) {
      reportFailure(ctx, error, true);
    }
    return;
  }

  try {
    if (method !== 'GET' && method !== 'HEAD') {
      throw methodNotAllowed(['GET', 'HEAD']);
    }
    await renderPage(ctx);
  } catch (error) {
    reportFailure(ctx, error, false);
  }
}

function requireOwnOrigin(ctx: Ctx): void {
  const origin = ctx.header('origin');
  if (origin === null || origin === '' || origin === 'null') return;
  if (!ctx.allowedOrigins.includes(origin)) throw crossOrigin();
}

function reportFailure(ctx: Ctx, error: unknown, asJson: boolean): void {
  if (ctx.response.headersSent) return;
  const apiError =
    error instanceof ApiError ? error : new ApiError(500, 'server_error', { message: 'Server error' });
  if (!(error instanceof ApiError)) {
    process.stderr.write(`request failed: ${String(error)}\n`);
  }
  if (asJson) {
    sendApiError(ctx.response, apiError);
    return;
  }
  sendText(
    ctx.response,
    apiError.status,
    'text/html; charset=utf-8',
    `<!doctype html><title>Hourline</title><p>${apiError.code}`,
    apiError.headers,
  );
}

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await applySeed();
  startSweep();

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500).end();
    });
  });
  server.keepAliveTimeout = 10_000;
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`hourline listening on 0.0.0.0:${config.port}\n`);
  });
}

await main();
