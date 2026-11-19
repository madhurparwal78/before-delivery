import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, uploadCapLabel } from './config.js';
import { applySchema } from './db.js';
import { applyStarterSeed } from './seed.js';
import { startListening } from './events.js';
import { now as clockNow } from './clock.js';
import { ensureBucket, storageReachable } from './s3.js';
import { personForToken, SESSION_COOKIE, teamsOf } from './auth.js';
import {
  ApiError,
  HARD_BODY_CEILING,
  parseCookies,
  readBody,
  Router,
  sendJson,
  type Ctx,
} from './http.js';
import { registerCoreRoutes } from './api.js';
import { registerExtraRoutes } from './apiExtra.js';
import { registerGradingRoutes } from './grading.js';
import { runDueWork } from './due.js';

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const router = new Router();
registerCoreRoutes(router);
registerExtraRoutes(router);
registerGradingRoutes(router);

let ready = false;

async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  if (relative === '' || relative.includes('..')) return false;
  const file = join(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR)) return false;
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'content-length': String(body.length),
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

async function serveShell(res: ServerResponse): Promise<void> {
  const shell = (await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8')).replace(
    '%UPLOAD_CAP%',
    uploadCapLabel(),
  );
  const body = Buffer.from(shell, 'utf8');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/api/health') {
    if (!ready) {
      sendJson(res, 503, { status: 'starting' });
      return;
    }
    sendJson(res, 200, { status: (await storageReachable()) ? 'ok' : 'unavailable' });
    return;
  }

  const isApi = pathname.startsWith('/api/') || pathname.startsWith('/grading/');
  if (!isApi) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (await serveStatic(res, pathname)) return;
      // Page routes never carry a file extension, so an unmatched asset path is
      // a miss rather than a page: source, lockfiles and secrets stay unserved.
      if (/\.[A-Za-z0-9]+$/.test(pathname)) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      await serveShell(res);
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const match = router.match(req.method ?? 'GET', pathname);
  const { raw, truncated } = await readBody(req);
  if (!match) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  if (truncated) {
    sendJson(res, 413, { error: 'body_too_large' });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const person = await personForToken(cookies[SESSION_COOKIE]);
  const cookieValues: string[] = [];
  const ctx: Ctx = {
    req,
    res,
    method: req.method ?? 'GET',
    url,
    params: match.params,
    raw,
    rawTruncated: truncated,
    person,
    teams: person ? (await teamsOf(person.id)).map((t) => t.id) : [],
    setCookie: (value) => {
      cookieValues.push(value);
      res.setHeader('set-cookie', cookieValues);
    },
  };

  try {
    await match.handler(ctx);
  } catch (err) {
    if (err instanceof ApiError) {
      sendJson(res, err.status, err.body);
      return;
    }
    process.stderr.write(`request failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
  }
}

async function boot(): Promise<void> {
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 72000;
  server.listen(config.port, '0.0.0.0');

  while (!ready) {
    try {
      await applySchema();
      await applyStarterSeed();
      await startListening();
      ready = true;
    } catch (err) {
      process.stderr.write(`waiting for the database: ${String(err)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  void ensureBucket().catch(() => undefined);

  if (!config.grading) {
    let lastDueRun: Date | null = null;
    setInterval(() => {
      void (async () => {
        const current = await clockNow();
        await runDueWork(lastDueRun, current);
        lastDueRun = current;
      })().catch(() => undefined);
    }, 15000);
  }
}

void boot();
