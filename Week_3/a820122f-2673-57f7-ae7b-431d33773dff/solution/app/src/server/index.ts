import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema } from './db/pool.js';
import { applySeed } from './db/seed.js';
import * as store from './db/store.js';
import { ApiError } from './http/errors.js';
import {
  SESSION_COOKIE,
  checkContentType,
  checkOrigin,
  matchRoute,
  parseJsonBody,
  readBody,
  readCookie,
  route,
  sendError,
  sendJson,
  type RequestContext,
} from './http/router.js';
import { registerIdentityRoutes } from './routes/identity.js';
import { registerFleetRoutes } from './routes/fleet.js';
import { registerEntryRoutes } from './routes/entries.js';
import { registerRecordRoutes } from './routes/records.js';
import { registerMonthRoutes } from './routes/months.js';
import { registerLinkRoutes } from './routes/links.js';
import { startArchiveWatch } from './services/archive.js';
import { retryAwaitingMonths } from './services/sealing.js';

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

const assets = new Map<string, { body: Buffer; contentType: string }>();

async function loadAssets(directory: string, prefix: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await loadAssets(path, `${prefix}${entry.name}/`);
      continue;
    }
    const contentType = CONTENT_TYPES[extname(entry.name)];
    if (contentType === undefined) continue;
    assets.set(`${prefix}${entry.name}`, { body: await readFile(path), contentType });
  }
}

const PAGE_PATTERNS = [
  /^\/$/,
  /^\/fleet$/,
  /^\/vessels\/[^/]+$/,
  /^\/log$/,
  /^\/voyage\/[^/]+\/[^/]+$/,
  /^\/inspect\/[^/]+$/,
];

function sendAsset(res: ServerResponse, name: string): boolean {
  const asset = assets.get(name);
  if (asset === undefined) return false;
  res.writeHead(200, {
    'content-type': asset.contentType,
    'content-length': asset.body.byteLength,
    'cache-control': name === 'index.html' ? 'no-store' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  res.end(asset.body);
  return true;
}

function sendShell(res: ServerResponse, status: number): void {
  const shell = assets.get('index.html');
  if (shell === undefined) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('The application shell is missing.');
    return;
  }
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': shell.body.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(shell.body);
}

function registerHealthRoute(): void {
  route('GET', '/api/health', 'none', async (context) => {
    sendJson(context.res, 200, { status: 'ok' });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (!path.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') {
      sendShell(res, 404);
      return;
    }
    if (path === '/service-worker.js' && sendAsset(res, 'service-worker.js')) return;
    if (path.startsWith('/static/') && sendAsset(res, path.slice('/static/'.length))) return;
    if (PAGE_PATTERNS.some((pattern) => pattern.test(path))) {
      sendShell(res, 200);
      return;
    }
    sendShell(res, 404);
    return;
  }

  try {
    checkOrigin(req);
    if (path.startsWith('/api/inspect/') && method !== 'GET') {
      throw new ApiError(405, 'read_only');
    }
    const rawBody = await readBody(req);
    checkContentType(req, rawBody);
    const token = readCookie(req, SESSION_COOKIE);
    const session = token === null ? null : await store.findSession(token);
    const matched = matchRoute(method, path);
    if (matched === null) {
      throw new ApiError(404, 'not_found');
    }
    if (matched.route.auth === 'session' && session === null) {
      throw new ApiError(401, 'not_signed_in');
    }
    const context: RequestContext = {
      req,
      res,
      method,
      path,
      params: matched.params,
      query: url.searchParams,
      rawBody,
      session,
      nowMs: Date.now(),
      json: () => parseJsonBody(rawBody),
    };
    await matched.route.handler(context);
  } catch (error) {
    sendError(res, error);
  }
}

async function start(): Promise<void> {
  await loadAssets(STATIC_DIR, '');
  registerHealthRoute();
  registerIdentityRoutes();
  registerFleetRoutes();
  registerEntryRoutes();
  registerRecordRoutes();
  registerMonthRoutes();
  registerLinkRoutes();

  for (let attempt = 1; ; attempt += 1) {
    try {
      await applySchema();
      await applySeed();
      break;
    } catch (error) {
      if (attempt >= 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  startArchiveWatch(async (status) => {
    if (status.archive === 'reachable') await retryAwaitingMonths();
  });

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      sendError(res, error);
    });
  });
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Sixbell Rest Log listening on port ${config.port}\n`);
  });
}

void start();
