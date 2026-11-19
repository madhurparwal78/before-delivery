import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../shared/errors.js';
import { config } from './config.js';
import { applySchema } from './db.js';
import { Router, sendHtml, sendJson, type Ctx } from './http.js';
import { pruneEvents, sweepSafariSeats } from './live.js';
import { registerApi } from './routes/api.js';
import { registerPages, Redirected } from './routes/pages.js';
import { ensureMainWorld } from './seed.js';
import { ensureBucket } from './storage.js';
import { page } from './views/html.js';

const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const router = new Router();
registerApi(router);
registerPages(router);

async function serveStatic(ctx: Ctx): Promise<boolean> {
  const extension = extname(ctx.url.pathname);
  if (!(extension in MIME)) return false;
  const relative = normalize(ctx.url.pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(publicDir, relative));
    ctx.res.writeHead(200, {
      'content-type': MIME[extension],
      'cache-control': extension === '.woff2' ? 'public, max-age=604800' : 'no-store',
    });
    ctx.res.end(ctx.method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    return false;
  }
}

function sendError(ctx: Ctx, error: ApiError): void {
  const headers: Record<string, string> = {};
  if (error.detail.retryAfter !== undefined) headers['retry-after'] = String(error.detail.retryAfter);
  if (ctx.url.pathname.startsWith('/api/')) {
    sendJson(ctx, error.status, error.body(), headers);
    return;
  }
  sendHtml(
    ctx,
    error.status,
    page({ title: 'Nothing here — Hushfoot', bootstrap: { page: 'not-found' } }, `<main id="main"><h1>Nothing here</h1></main>`),
  );
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const ctx: Ctx = { req, res, url, method: req.method ?? 'GET', params: {} };
  void (async () => {
    try {
      const matched = router.match(ctx.method, url.pathname);
      if (matched) {
        ctx.params = matched.params;
        await matched.handler(ctx);
        return;
      }
      if (await serveStatic(ctx)) return;
      throw new ApiError('not_found');
    } catch (error) {
      if (error instanceof Redirected) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof ApiError) {
        sendError(ctx, error);
        return;
      }
      process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
      sendJson(ctx, 500, { error: 'bad_request', message: "That request isn't valid." });
    }
  })();
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 72_000;

async function boot(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await ensureMainWorld();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

await ensureBucket().catch(() => undefined);
server.listen(config.port, '0.0.0.0');
void boot();

setInterval(() => {
  void sweepSafariSeats().catch(() => undefined);
}, 500);

setInterval(() => {
  void pruneEvents().catch(() => undefined);
}, 60_000);
