import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.js';
import { migrateAndSeed, callbackSecret } from './store.js';
import { Killbill } from './services/killbill.js';
import { Registry } from './services/registry.js';
import { Mailer } from './services/mailer.js';
import { startBackground } from './background.js';
import { route, type RouteDeps } from './api.js';
import { healthyDatabase } from './db.js';
import { HttpError, errorBody, parseCookies, crossOriginBlocked, MAX_BODY_BYTES, type RequestCtx } from './http.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '../public');
const config = readConfig();

// Static assets: only files inside dist/public are served; the server never
// serves source files, environment files, credentials or the callback secret.
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.map': 'application/json',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

function readBodyNode(req: http.IncomingMessage): Promise<{ body: unknown; raw: Buffer | null; tooLarge: boolean }> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => resolvePromise({ body: null, raw: null, tooLarge }));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (raw.length === 0) return resolvePromise({ body: null, raw, tooLarge });
      try {
        resolvePromise({ body: JSON.parse(raw.toString('utf8')), raw, tooLarge });
      } catch {
        resolvePromise({ body: null, raw, tooLarge });
      }
    });
  });
}

const kb = new Killbill(config);
const registry = new Registry(config);
const mailer = new Mailer(config);

let background: ReturnType<typeof startBackground> | null = null;
let cachedSecret: string | null = null;

const server = http.createServer(async (req, res): Promise<void> => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const headersLower = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : (v ?? undefined)]));

    if (crossOriginBlocked(req.method ?? 'GET', url, headersLower)) {
      return sendJson(res, 403, errorBody('cross_origin'));
    }

    if (path === '/api/health') {
      return sendJson(res, 200, { status: 'ok' });
    }

    if (path.startsWith('/api/')) {
      const { body, raw, tooLarge } = await readBodyNode(req);
      if (tooLarge) return sendJson(res, 413, errorBody('payload_too_large'));
      const ctx: RequestCtx = {
        method: req.method ?? 'GET',
        path,
        url,
        body,
        rawBody: raw,
        headers: headersLower,
        cookies: parseCookies(headersLower['cookie']),
      };
      if (background === null) {
        return sendJson(res, 503, errorBody('database_unreachable'));
      }
      if (!(await healthyDatabase(config))) {
        if (path === '/api/status') {
          return sendJson(res, 200, {
            killbill: background.providers.killbill,
            registry: background.providers.registry,
            serverNow: new Date().toISOString(),
          });
        }
        return sendJson(res, 503, errorBody('database_unreachable'));
      }
      if (path.startsWith('/api/killbill/notifications/') || cachedSecret === null) {
        cachedSecret = await callbackSecret(config);
      }
      const deps: RouteDeps = {
        config,
        registry,
        killbill: kb,
        providers: background.providers,
        secret: cachedSecret,
      };
      const result = await route(ctx, deps);
      const extra: Record<string, string> = {};
      if (result.setCookie) extra['Set-Cookie'] = result.setCookie;
      if (result.clearCookie) extra['Set-Cookie'] = 'ommezwaai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
      return sendJson(res, result.status, result.body, extra);
    }

    // Static files and the SPA.
    let rel = path === '/' ? 'index.html' : path.slice(1);
    const target = resolve(publicDir, rel);
    if (target.startsWith(publicDir + '/') && existsSync(target)) {
      const data = readFileSync(target);
      const ext = target.slice(target.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
      res.end(data);
      return;
    }
    const index = join(publicDir, 'index.html');
    const data = readFileSync(index);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
    res.end(data);
    return;
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, e.body);
    console.error('server error', e);
    return sendJson(res, 500, errorBody('internal'));
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`ommezwaai feeler listening on port ${config.port}`);
});

// Schema and seed apply idempotently on every serve, safely when several
// instances start at once; a provider down never stops the server.
void (async () => {
  for (;;) {
    try {
      await migrateAndSeed(config);
      background = startBackground(config, kb, registry, mailer, () => { cachedSecret = null; });
      break;
    } catch (err) {
      console.error('waiting for database', err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
})();
