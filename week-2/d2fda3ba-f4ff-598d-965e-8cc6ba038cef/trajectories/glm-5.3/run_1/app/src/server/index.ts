import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { config } from './config';
import { poolGet } from './db';
import { ApiError, type Ctx, type RawBody } from './api_types';
import { accountOf } from './api/core';
import { routes } from './api/auth_routes';
import './api/revision_routes';
import './api/billing_routes';
import './api/dossier_routes';
import './api/ops_routes';
import { runSweep } from './api/ops_routes';
import { servePublic } from './public_routes';
import { seed } from './seed';
import { kb } from './killbill';
import { ensureBucket } from './s3';

const DIST = new URL('.', import.meta.url).pathname;
const PUBLIC_DIR = join(DIST, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const LIMITS = { api: 1_000_000, push: 4_000_000, manifest: 5_000_000 };

const blockedPath = (pathname: string): boolean =>
  pathname === '/run.json' || pathname === '/package.json' || pathname === '/package-lock.json'
  || pathname === '/tsconfig.json' || pathname.startsWith('/.')
  || pathname.startsWith('/src/') || pathname.startsWith('/dist/') && !pathname.startsWith('/dist/public/')
  || pathname.startsWith('/scripts/') || pathname.startsWith('/node_modules/')
  || pathname.endsWith('.ts') || pathname.endsWith('.env');

const readBody = (req: IncomingMessage, limit: number): Promise<RawBody | undefined> =>
  new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c: Buffer) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(new ApiError('payload_too_large', 'That request is too large.'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return;
      const buf = Buffer.concat(chunks);
      resolve({ buf, json: () => { try { return JSON.parse(buf.toString('utf8') || 'null'); } catch { throw new ApiError('validation_failed', 'Invalid JSON.', { fields: { body: 'must be valid JSON' } }); } } });
    });
    req.on('error', reject);
  });

const errorBody = (e: ApiError): Record<string, unknown> => {
  const err: Record<string, unknown> = { code: e.code, message: e.message };
  if (e.fields) err.fields = e.fields;
  if (e.extra) Object.assign(err, e.extra);
  return { error: err };
};

const serveStatic = (res: ServerResponse, pathname: string): boolean => {
  if (blockedPath(pathname)) return false;
  const file = pathname === '/' ? '/index.html' : pathname;
  const full = join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return false;
  if (!existsSync(full) || !statSync(full).isFile()) return false;
  const buf = readFileSync(full);
  res.writeHead(200, {
    'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  });
  res.end(buf);
  return true;
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
    const pathname = decodeURIComponent(url.pathname);
    const origin = req.headers.origin;
    const ownOrigin = config.publicUrl;

    // public dossier and preview routes first: they never reach the API
    if (await servePublic(req, res, pathname)) return;

    if (pathname.startsWith('/api/')) {
      const method = req.method ?? 'GET';
      // server boundary: content type and origin
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        if (origin && origin !== ownOrigin && origin !== `http://localhost:${config.port}` && origin !== `http://127.0.0.1:${config.port}`) {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: { code: 'cross_origin', message: 'Requests must come from the same origin.' } }));
          return;
        }
        const ct = req.headers['content-type'] ?? '';
        if (ct !== '' && !ct.toLowerCase().startsWith('application/json')) {
          res.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: { code: 'unsupported_media_type', message: 'Requests must use application/json.' } }));
          return;
        }
      }
      const matched = routes.filter((r) => r.pattern.test(pathname));
      const route = matched.find((r) => r.method === method);
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'not_found', message: 'No such endpoint.' } }));
        return;
      }
      const m = route.pattern.exec(pathname) as RegExpExecArray | null;
      let body: RawBody | undefined;
      try {
        body = await readBody(req, route.limit ?? LIMITS.api);
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 500;
        const payload = e instanceof ApiError ? errorBody(e) : { error: { code: 'internal_error', message: 'Something went wrong.' } };
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
        return;
      }
      const cookies: Record<string, string> = {};
      for (const part of (req.headers.cookie ?? '').split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) cookies[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
      }
      const setCookies: string[] = [];
      const ctx: Ctx = {
        url,
        method,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
        accountId: null, deviceId: null, accountOperator: false, accountEmail: null, accountTimeZone: null,
        cookies,
        setCookie: (v: string) => setCookies.push(v),
        originOk: true,
      };
      const a = await accountOf(ctx);
      if (a) {
        ctx.accountId = a.id;
        ctx.deviceId = (a as unknown as { device_id: string }).device_id;
        ctx.accountOperator = a.operator;
        ctx.accountEmail = a.email;
        ctx.accountTimeZone = a.time_zone;
      }
      try {
        const params = m ? m.slice(1) : [];
        const result = await route.handler(ctx, params);
        if (!result) {
          res.writeHead(204);
          res.end();
        } else {
          const headers: Record<string, string | number> = {
            'Content-Type': result.body instanceof Buffer ? String(result.headers?.['Content-Type'] ?? 'application/octet-stream') : 'application/json; charset=utf-8',
            ...(result.headers ?? {}),
          };
          const setCookie = setCookies.join('; ');
          if (setCookie) headers['Set-Cookie'] = setCookie;
          const payload = result.body instanceof Buffer ? result.body : result.body === undefined ? '' : JSON.stringify(result.body);
          res.writeHead(result.status, headers as Record<string, string | number>);
          res.end(payload);
        }
      } catch (e) {
        if (e instanceof ApiError) {
          const headers: Record<string, string | number> = { 'Content-Type': 'application/json; charset=utf-8' };
          const setCookie = setCookies.join('; ');
          if (setCookie) headers['Set-Cookie'] = setCookie;
          res.writeHead(e.status, headers);
          res.end(JSON.stringify(errorBody(e)));
        } else {
          console.error('api error', e);
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong.' } }));
        }
      }
      return;
    }

    if (serveStatic(res, pathname)) return;
    // browser routes
    if (pathname === '/' || pathname.startsWith('/devices/approve/') || pathname.startsWith('/invites/') || pathname === '/ops') {
      const shell = join(PUBLIC_DIR, 'index.html');
      if (existsSync(shell)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(readFileSync(shell));
        return;
      }
    }
    if (pathname === '/assets/reader.css') {
      const css = join(PUBLIC_DIR, 'assets', 'reader.css');
      if (existsSync(css)) {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(readFileSync(css));
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong.' } }));
    }
  }
});

const start = async (): Promise<void> => {
  await poolGet();
  const catalog = await kb.ensureCatalog();
  void catalog;
  try {
    await ensureBucket();
  } catch {
    // storage unreachable at start: health stays ok and requests answer 503 until it returns
  }
  try {
    await seed();
  } catch {
    // retried by the sweep
  }
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`cairn listening on ${config.port}`);
  });
  const interval = Math.min(60, Math.max(1, config.timers.sweepInterval)) * 1000;
  setInterval(() => {
    runSweep().catch(() => undefined);
  }, interval);
  const { mail } = await import('./mail');
  setInterval(() => {
    mail.flush().catch(() => undefined);
  }, 15000);
};

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
