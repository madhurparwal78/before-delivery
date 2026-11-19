// The HTTP server: boundary, routing, static serving and the jobs start.

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { getDb } from './db.js';
import { applySchema } from './schema.js';
import { seed } from './seed.js';
import { loadConfig } from './config.js';
import { Storage } from './services/storage.js';
import { Mailer } from './services/mailer.js';
import { KillBill } from './services/killbill.js';
import { notFound } from './errors.js';
import { checkSameOrigin, isNeverServed } from './boundary.js';
import { accountFromSession } from './context.js';
import { authRoutes } from './api/auth.js';
import { workspaceRoutes } from './api/workspaces.js';
import { clusterRoutes } from './api/clusters.js';
import { reviewRoutes } from './api/review.js';
import { publicRoutes } from './api/public.js';
import { mediaRoutes } from './api/media.js';
import { startJobs } from './jobs.js';
import { syncSeedObjects } from './objects.js';
import { KillBillSync } from './billing-sync.js';
import { sendJson, sendError } from './http-helpers.js';
import type { App, Ctx, Handler } from './app.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(moduleDir, '../../public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const db = getDb(config.databaseUrl);
  await applySchema(db);
  await seed(db);

  const storage = new Storage(config);
  const mailer = new Mailer(config);
  const killbill = new KillBill(config.killbill);
  const kbSync = new KillBillSync(db, killbill);
  const app: App = { config, db, storage, mailer, killbill, kbSync };

  // These sync in the background; the server serves health regardless.
  void syncSeedObjects(db, storage).catch(() => {});
  void kbSync.ensureAll().catch(() => {});

  const server = http.createServer(async (req, res) => {
    try {
      await handle(app, req, res);
    } catch (e) {
      sendError(res, e);
    }
  });

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Rushes listening on port ${config.port}\n`);
  });
  startJobs(app);
}

async function handle(app: App, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  // Never-served paths answer 404 before any other request check. The check runs
  // on the raw request target (decoded once) too, before URL normalisation erases
  // encoded or literal `..` segments.
  const rawTarget = decodeURIComponentSafe(req.url ?? '/');
  if (isNeverServed(rawTarget) || isNeverServed(decodeURIComponentSafe(url.pathname))) {
    sendError(res, notFound());
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }

  // Same-origin writes come before every other check.
  checkSameOrigin(req);

  if (method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (pathname.startsWith('/api/') || pathname.startsWith('/media/')) {
    const ctx: Ctx = { db: app.db, account: await sessionAccount(app, req) };
    const route = pickApiRoute(method, pathname);
    if (!route) {
      sendError(res, notFound());
      return;
    }
    await route(app, req, res, ctx, url);
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendError(res, notFound());
    return;
  }

  await serveStatic(res, pathname);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function sessionAccount(app: App, req: http.IncomingMessage) {
  const cookies = req.headers.cookie ?? '';
  const m = /(?:^|;\s*)rushes_session=([^;]+)/.exec(cookies);
  if (!m) return null;
  return accountFromSession(app.db, decodeURIComponent(m[1]!));
}

function pickApiRoute(method: string, pathname: string): Handler | null {
  const routes = [authRoutes, workspaceRoutes, clusterRoutes, reviewRoutes, publicRoutes, mediaRoutes];
  for (const group of routes) {
    const h = group(method, pathname);
    if (h) return h;
  }
  return null;
}

async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
  const clean = pathname.replace(/^\/+/, '');
  const candidates = clean === '' ? ['index.html'] : [clean, path.join(clean, 'index.html')];
  for (const c of candidates) {
    const file = path.join(clientDir, c);
    if (!file.startsWith(clientDir)) continue;
    if (existsSync(file) && statSync(file).isFile()) {
      const ext = path.extname(file);
      const mime = MIME[ext] ?? 'application/octet-stream';
      const body = readFileSync(file);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
      return;
    }
  }
  // The SPA shell.
  const shellPath = path.join(clientDir, 'index.html');
  if (existsSync(shellPath)) {
    const body = readFileSync(shellPath);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
    return;
  }
  sendError(res, notFound());
}

// Entry point: start when run directly.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  void startServer();
}
