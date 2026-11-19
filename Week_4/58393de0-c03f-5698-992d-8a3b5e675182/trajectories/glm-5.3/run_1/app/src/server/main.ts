import pg from 'pg';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type ServerConfig } from './config.js';
import { createPool, applySchema } from './db.js';
import { createStorage } from './storage.js';
import { buildRoutes } from './routes.js';
import type { Route } from './router.js';
import { matchRoute, type Ctx } from './router.js';
import { sendJson, sendError, apiError, type ApiErrorBody } from './apiError.js';
import { loadSession } from './sessions.js';

const cfg: ServerConfig = loadConfig();
const pool: pg.Pool = createPool(cfg.databaseUrl);
const storage = createStorage(cfg.s3);
let dbReady = false;

const BODY_LIMITS: Array<[RegExp, number]> = [
  [/^\/api\/projects$/, 2_000_000],
  [/^\/api\/projects\/[^/]+$/, 2_000_000],
  [/^\/api\/exports$/, 20_000_000],
];
const DEFAULT_JSON_LIMIT = 1_000_000;

async function initDb(): Promise<void> {
  try {
    await applySchema(pool);
    if (!dbReady) console.log('database ready');
    dbReady = true;
  } catch (err) {
    dbReady = false;
    console.error('database not ready, will retry', (err as Error).message);
  }
}

const routes: Route[] = buildRoutes({ pool, cfg, storage });

const server = http.createServer((req, res) => {
  void handle(req, res).catch((err) => {
    console.error('request error', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal', message: 'Something went wrong.' }));
    } else {
      res.end();
    }
  });
});

function readBody(req: http.IncomingMessage, limit: number): Promise<{ ok: true; data: Buffer } | { ok: false; reason: 'too_large' | 'error' }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (r: { ok: true; data: Buffer } | { ok: false; reason: 'too_large' | 'error' }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        // Keep the connection usable: consume the rest, then report.
        chunks.length = 0;
        req.removeAllListeners('data');
        req.on('data', () => { /* drain */ });
        finish({ ok: false, reason: 'too_large' });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => finish({ ok: true, data: Buffer.concat(chunks) }));
    req.on('error', () => finish({ ok: false, reason: 'error' }));
  });
}

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

const SPA_EXACT = new Set(['/', '/index.html', '/signup', '/signin', '/join', '/dashboard', '/class', '/projects', '/verify']);
const SPA_PREFIXES = ['/classrooms/', '/editor/'];

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url, method);
    return;
  }
  await handleStatic(res, url, method);
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<void> {
  if (url.pathname === '/api/health') {
    let ok = dbReady;
    if (ok) {
      try {
        const deadline = Date.now() + 2000;
        const check = await Promise.race([storage.ping().then(() => true).catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), Math.max(0, deadline - Date.now())))]);
        ok = check;
      } catch {
        ok = false;
      }
    }
    sendJson(res, 200, { status: ok ? 'ok' : 'unavailable' });
    return;
  }

  const origin = req.headers.origin;
  if (origin && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
    let allowedOrigin: string;
    try {
      allowedOrigin = new URL(cfg.publicUrl).origin;
    } catch {
      allowedOrigin = `http://127.0.0.1:${cfg.port}`;
    }
    if (origin !== allowedOrigin) {
      sendError(res, apiError(403, 'forbidden', 'Not found.'));
      return;
    }
  }

  const matched = matchRoute(routes, method, url.pathname);
  if (!matched) {
    sendError(res, apiError(404, 'not_found', 'Not found.'));
    return;
  }

  let rawBody: Buffer = Buffer.alloc(0);
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const limit = BODY_LIMITS.find(([re]) => re.test(url.pathname))?.[1] ?? DEFAULT_JSON_LIMIT;
    const result = await readBody(req, limit);
    if (!result.ok) {
      sendError(res, result.reason === 'too_large'
        ? apiError(413, 'too_large', 'That is too large to upload.')
        : apiError(400, 'bad_request', 'Check the highlighted fields.'));
      return;
    }
    rawBody = result.data;
  }

  let body: unknown = undefined;
  if (rawBody.length > 0 && url.pathname !== '/api/exports') {
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      sendError(res, apiError(415, 'unsupported_media', 'Check the highlighted fields.'));
      return;
    }
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      sendError(res, apiError(400, 'bad_request', 'Check the highlighted fields.'));
      return;
    }
  }

  const cookieToken = parseCookie(req.headers.cookie ?? '', 'qy_session');
  const session = cookieToken ? await loadSession(pool, cookieToken) : null;

  const ctx: Ctx = {
    req, res, pool, cfg, url, method, body, rawBody, session,
    accountId: session?.accountId ?? null,
    kind: session?.kind ?? 'none',
    ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown',
    params: matched.params,
  };

  if (!dbReady) {
    sendError(res, apiError(503, 'database_unavailable', 'Storage is unavailable. Try again in a minute.'));
    return;
  }

  const result = await matched.route.handler(ctx);
  if (result !== undefined && result !== null && !res.writableEnded) {
    const r = result as { status: number; body?: unknown; headers?: Record<string, string | number> };
    if (r.status === 204 || r.status === 302) {
      res.writeHead(r.status, r.headers ?? {});
      res.end();
    } else if (r.status >= 400 && (r.body as ApiErrorBody | undefined)?.error !== undefined) {
      sendError(res, r as { status: number; body: ApiErrorBody }, r.headers as Record<string, string> | undefined);
    } else if (r.body instanceof Buffer) {
      res.writeHead(r.status, r.headers ?? {});
      res.end(r.body);
    } else {
      sendJson(res, r.status, r.body);
    }
  }
}

const pubDir = join(dirname(fileURLToPath(import.meta.url)), 'public');

function resolvePublic(p: string): string | null {
  const norm = normalize(p);
  if (norm.split('/').includes('..')) return null;
  const full = join(pubDir, norm);
  if (!full.startsWith(pubDir + '/') && full !== pubDir) return null;
  return full;
}

async function handleStatic(res: http.ServerResponse, url: URL, method: string): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { /* keep raw */ }
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  const isSpa = SPA_EXACT.has(pathname) || SPA_PREFIXES.some((p) => pathname.startsWith(p));
  const target = isSpa ? '/index.html' : pathname;
  const file = resolvePublic(target);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  try {
    const data = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': String(data.length) });
    res.end(method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

server.listen(cfg.port, '0.0.0.0', () => {
  console.log(`quarkyard listening on port ${cfg.port}`);
});

const retryTimer = setInterval(() => { if (!dbReady) void initDb(); }, 2000);
retryTimer.unref?.();

export { cfg, pool, storage };
