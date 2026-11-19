import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import pg from 'pg';
import { parseCookies, readBody, HttpError, sendJson, buyerCookieHeader, ownerCookieHeader, newBuyerId } from './http';
import type { RequestScope } from './http';
import { ApiError } from './errors';
import { ensureSchema } from './streams';
import { apiRoutes, type ApiDeps } from './api';
import { KillBillClient } from './killbill';
import { Mailer } from './mailer';
import { startSweeper } from './expiry';

const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const HOLD_SECONDS = Number(process.env.HOLD_SECONDS ?? 600);
const OFFER_SECONDS = Number(process.env.OFFER_SECONDS ?? 900);

const { Pool } = pg;
const db = new Pool({ connectionString: DATABASE_URL, max: 20 });
const killbill = new KillBillClient({
  url: process.env.KILLBILL_URL ?? '',
  username: process.env.KILLBILL_USERNAME ?? '',
  password: process.env.KILLBILL_PASSWORD ?? '',
  apiKey: process.env.KILLBILL_API_KEY ?? '',
  apiSecret: process.env.KILLBILL_API_SECRET ?? '',
});
const mailer = new Mailer(
  { host: process.env.SMTP_HOST ?? '', port: Number(process.env.SMTP_PORT ?? 25), from: process.env.MAIL_FROM ?? '' },
  db,
);

const deps: ApiDeps = { db, killbill, mailer, holdSeconds: HOLD_SECONDS, offerSeconds: OFFER_SECONDS };

let schemaReady = false;

const routes = apiRoutes();

const PAGE_PATHS = new Set([
  '/',
  '/tickets',
  '/owner',
  '/owner/new',
  '/owner/orders',
  '/owner/outbox',
]);

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function main(): Promise<void> {
  await waitForDatabase();
  startSweeper({ db, mailer, offerSeconds: OFFER_SECONDS });
  mailer.startRetryLoop();

  const server = http.createServer((req, res) => {
    const pending: Map<string, unknown> = new Map();
    handle(req, res, pending).catch((error: unknown) => {
      respondWithError(res, error, pending);
    });
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`halyard-seatwise listening on 0.0.0.0:${PORT}`);
  });
}

function respondWithError(res: http.ServerResponse, error: unknown, pending: Map<string, unknown>): void {
  try {
    if (error instanceof HttpError) {
      appendOwnerCookies(res, pending);
      sendJson(res, error.status, { error: error.code, ...error.extra });
      return;
    }
    if (error instanceof ApiError) {
      appendOwnerCookies(res, pending);
      sendJson(res, error.status, error.body);
      return;
    }
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal' });
      return;
    }
    res.end();
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end();
  }
}

function appendOwnerCookies(res: http.ServerResponse, pending: Map<string, unknown>): void {
  const setOwner = pending.get('setOwnerCookie');
  if (typeof setOwner === 'string') {
    const existing = res.getHeader('Set-Cookie');
    const cookies = existing ? (Array.isArray(existing) ? [...existing] : [String(existing)]) : [];
    cookies.push(ownerCookieHeader(setOwner));
    res.setHeader('Set-Cookie', cookies);
  }
  if (pending.get('clearOwnerCookie') === true) {
    const existing = res.getHeader('Set-Cookie');
    const cookies = existing ? (Array.isArray(existing) ? [...existing] : [String(existing)]) : [];
    cookies.push('seatwise_owner=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.setHeader('Set-Cookie', cookies);
  }
}

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await ensureSchema(db);
      schemaReady = true;
      return;
    } catch (error) {
      console.error('database not ready, retrying in 2 seconds');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, pending: Map<string, unknown>): Promise<void> {
  const host = req.headers.host ?? '';
  const origin = req.headers.origin;
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== host) {
        sendJson(res, 403, { error: 'cross_origin' });
        return;
      }
    } catch {
      sendJson(res, 403, { error: 'cross_origin' });
      return;
    }
  }

  const url = new URL(req.url ?? '/', `http://${host || 'localhost'}`);
  const method = (req.method ?? 'GET').toUpperCase();

  if (url.pathname === '/api/health') {
    if (!schemaReady) {
      sendJson(res, 503, { status: 'starting' });
      return;
    }
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const scope: RequestScope = {
    req,
    res,
    url,
    method,
    cookies,
    rawBody: Buffer.alloc(0),
    bodyJson: null,
    buyerId: cookies['seatwise_buyer'] ?? null,
    buyerCookieWasFresh: Boolean(cookies['seatwise_buyer']),
    ownerAuthed: false,
    setBuyerCookie: false,
    state: pending,
  };

  if (url.pathname.startsWith('/api/')) {
    await handleApi(scope);
    return;
  }

  await servePageOrAsset(scope);
}

async function handleApi(scope: RequestScope): Promise<void> {
  if (scope.method === 'POST' || scope.method === 'PUT' || scope.method === 'DELETE' || scope.method === 'PATCH') {
    const contentType = scope.req.headers['content-type'] ?? '';
    const raw = await readBody(scope.req);
    scope.rawBody = raw;
    if (raw.length > 0) {
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new HttpError(415, 'unsupported_media_type');
      }
      try {
        scope.bodyJson = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new HttpError(400, 'bad_json');
      }
    } else {
      scope.bodyJson = {};
    }
  }
  const pathname = scope.url.pathname;
  for (const route of routes) {
    if (route.method !== scope.method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    if (!scope.buyerId) {
      scope.buyerId = newBuyerId();
      scope.setBuyerCookie = true;
    }
    applyPendingCookies(scope);
    await route.handler(scope, deps);
    return;
  }
  if (!scope.buyerId) {
    scope.buyerId = newBuyerId();
    scope.setBuyerCookie = true;
  }
  applyPendingCookies(scope);
  throw ApiError.notFound();
}

/** Sets cookie headers before any body is written; owner cookies may be appended later. */
function applyPendingCookies(scope: RequestScope): void {
  if (scope.setBuyerCookie && scope.buyerId) {
    scope.res.setHeader('Set-Cookie', buyerCookieHeader(scope.buyerId));
  }
}

async function servePageOrAsset(scope: RequestScope): Promise<void> {
  const pathname = decodeURIComponent(scope.url.pathname);
  if (pathname.startsWith('/assets/')) {
    await serveAsset(scope, pathname.slice('/assets'.length));
    return;
  }
  if (PAGE_PATHS.has(pathname) || pathname.startsWith('/p/') || pathname.startsWith('/offers/')) {
    await serveIndex(scope);
    return;
  }
  sendNotFoundPage(scope);
}

async function serveAsset(scope: RequestScope, assetPath: string): Promise<void> {
  const normalized = normalize(assetPath).replace(/^(\.\.[\/\\])+/, '');
  if (normalized.startsWith('..')) {
    sendNotFoundPage(scope);
    return;
  }
  const target = join(process.cwd(), 'public', 'assets', normalized);
  if (!target.startsWith(join(process.cwd(), 'public', 'assets'))) {
    sendNotFoundPage(scope);
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) {
      sendNotFoundPage(scope);
      return;
    }
    const content = await readFile(target);
    scope.res.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    scope.res.end(content);
  } catch {
    sendNotFoundPage(scope);
  }
}

let indexHtml: Buffer | null = null;

async function serveIndex(scope: RequestScope): Promise<void> {
  if (!indexHtml) {
    try {
      indexHtml = await readFile(join(process.cwd(), 'public', 'index.html'));
    } catch {
      sendNotFoundPage(scope);
      return;
    }
  }
  scope.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': indexHtml.length, 'Cache-Control': 'no-store' });
  scope.res.end(indexHtml);
}

function sendNotFoundPage(scope: RequestScope): void {
  const body = Buffer.from(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Halyard Hall</title></head><body><div id="root"></div>' +
      '<script>document.getElementById("root").innerHTML = "<h1>We couldn\'t find that page</h1>"</script></body></html>',
    'utf8',
  );
  scope.res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
  scope.res.end(body);
}

void main();
