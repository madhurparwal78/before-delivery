import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { initClock } from '../time.js';
import { applySchemaAndSeed, pool } from './db.js';
import {
  ApiError, Ctx, ctxAccount, clock, stations, createAccount, signIn, signOut, me,
  searchTrains, coaches, fareQuote, postBooking, listBookings, bookingBody,
  postCancellationQuote, postCancellation, publicPnr, downloadTicket,
} from './api.js';
import { startWorkers } from './workers.js';

// The server boundary: same-origin, body-size, content-type and idempotency
// rules, and the never-served rules.

const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);
const BODY_LIMIT = 65_536;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const SESSION_COOKIE = 'pakka_session';

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (d: Buffer) => {
      size += d.length;
      if (size > BODY_LIMIT) {
        reject(new ApiError(413, 'too_large', 'The request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}): void {
  const h = { ...headers };
  if (typeof body === 'string' && !h['Content-Type']) h['Content-Type'] = 'application/json; charset=utf-8';
  res.writeHead(status, h);
  res.end(body);
}

function errorBody(e: ApiError): string {
  const out: Record<string, unknown> = { error: e.code, message: e.message };
  if (e.extra) Object.assign(out, e.extra);
  return JSON.stringify(out);
}

async function main(): Promise<void> {
  initClock(process.env.RAIL_CLOCK_START, Number(process.env.RAIL_CLOCK_RATE ?? 1));

  // Keep retrying until Postgres is reachable, and never report healthy before.
  for (;;) {
    try {
      await applySchemaAndSeed();
      break;
    } catch (e) {
      console.error('Postgres unreachable; retrying in 2s', (e as Error).message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  startWorkers();

  const indexHtml = readFileSync(join(process.cwd(), 'public/index.html'));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      const path = decodeURIComponent(url.pathname);
      const method = (req.method ?? 'GET').toUpperCase();
      const cookies = parseCookies(req);
      const sessionId = cookies[SESSION_COOKIE];

      // Never-served rules.
      if (
        path === '/run.json' || path === '/package.json' || path === '/.env' ||
        path.startsWith('/.git') || path.startsWith('/dist/') || path.startsWith('/src/') ||
        path === '/package-lock.json' || path === '/tsconfig.json' || path === '/build.mjs' ||
        path === '/THIRD_PARTY_NOTICES.md'
      ) {
        send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }

      const ctx: Ctx = {
        method, path, query: url.searchParams, sessionId,
        accountId: sessionId,
      };

      // Cross-origin state changes.
      const origin = req.headers.origin;
      if (origin && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        const host = req.headers.host;
        let foreign = true;
        try {
          const o = new URL(origin);
          const selfOrigin = process.env.APP_PUBLIC_URL ? new URL(process.env.APP_PUBLIC_URL).origin : `http://${host}`;
          if (o.origin === selfOrigin || o.host === host) foreign = false;
        } catch { foreign = true; }
        if (foreign) {
          send(res, 403, JSON.stringify({ error: 'cross_origin', message: 'Requests must come from this site.' }));
          return;
        }
      }

      // Bodies: JSON only, with a size limit.
      const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
      let rawBody = Buffer.alloc(0);
      if (hasBody) {
        const declared = (req.headers['content-length'] ?? '');
        if (Number(declared) > BODY_LIMIT) {
          send(res, 413, JSON.stringify({ error: 'too_large', message: 'The request body is too large.' }));
          return;
        }
        rawBody = await readBody(req).catch((e) => {
          if (e instanceof ApiError) return null as unknown as Buffer;
          throw e;
        });
        if (rawBody === null) {
          send(res, 413, JSON.stringify({ error: 'too_large', message: 'The request body is too large.' }));
          return;
        }
        const ctype = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (rawBody.length > 0 && ctype !== 'application/json') {
          send(res, 415, JSON.stringify({ error: 'unsupported_media_type', message: 'Send application/json.' }));
          return;
        }
        if (rawBody.length > 0) {
          try {
            ctx.body = JSON.parse(rawBody.toString('utf8'));
          } catch {
            send(res, 400, JSON.stringify({ error: 'bad_json', message: 'The request body is not valid JSON.' }));
            return;
          }
        }
        ctx.rawBody = rawBody;
        ctx.idempotencyKey = (req.headers['idempotency-key'] ?? undefined) as string | undefined;
      }

      // ---------- API ----------
      if (path === '/api/health' && method === 'GET') {
        try {
          await pool.query('SELECT 1');
          send(res, 200, JSON.stringify({ status: 'ok' }));
        } catch {
          send(res, 503, JSON.stringify({ status: 'unavailable' }));
        }
        return;
      }

      if (path.startsWith('/api/')) {
        try {
          await routeApi(ctx, res, req);
        } catch (e) {
          if (e instanceof ApiError) {
            send(res, e.status, errorBody(e));
          } else {
            console.error('API error', e);
            send(res, 500, JSON.stringify({ error: 'internal', message: 'Something went wrong.' }));
          }
        }
        return;
      }

      // ---------- static and app ----------
      if (method === 'GET' || method === 'HEAD') {
        const publicDir = join(process.cwd(), 'public');
        const rel = path.replace(/^\/+/, '');
        const full = rel ? join(publicDir, rel) : null;
        if (full && rel && !rel.includes('..') && existsSync(full) && statSync(full).isFile()) {
          send(res, 200, readFileSync(full), {
            'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
            'Cache-Control': 'no-cache',
          });
          return;
        }
        // SPA: every app path renders the same shell.
        send(res, 200, indexHtml, { 'Content-Type': 'text/html; charset=utf-8' });
        return;
      }

      send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    } catch (e) {
      console.error('server error', e);
      if (!res.headersSent) send(res, 500, JSON.stringify({ error: 'internal', message: 'Something went wrong.' }));
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Pakka Rail listening on 0.0.0.0:${PORT}`);
  });
}

async function routeApi(ctx: Ctx, res: http.ServerResponse, req: http.IncomingMessage): Promise<void> {
  const { method, path } = ctx;

  if (path === '/api/clock' && method === 'GET') return send(res, 200, JSON.stringify(await clock()));
  if (path === '/api/stations' && method === 'GET') return send(res, 200, JSON.stringify(await stations()));

  if (path === '/api/accounts' && method === 'POST') {
    const r = await createAccount(ctx);
    setSession(res, r.sessionId);
    return send(res, r.status, JSON.stringify(r.body));
  }
  if (path === '/api/session' && method === 'POST') {
    const r = await signIn(ctx);
    setSession(res, r.sessionId);
    return send(res, r.status, JSON.stringify(r.body));
  }
  if (path === '/api/session' && method === 'DELETE') {
    const r = await signOut(ctx);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return send(res, r.status, r.body === null ? '' : JSON.stringify(r.body));
  }
  if (path === '/api/me' && method === 'GET') {
    const r = await me(ctx);
    return send(res, r.status, JSON.stringify(r.body));
  }

  if (path === '/api/trains' && method === 'GET') {
    return send(res, 200, JSON.stringify(await searchTrains(ctx)));
  }
  if (/^\/api\/trains\/\d+\/runs\/\d{4}-\d{2}-\d{2}\/coaches$/.test(path) && method === 'GET') {
    return send(res, 200, JSON.stringify(await coaches(ctx)));
  }
  if (path === '/api/fare-quote' && method === 'POST') {
    return send(res, 200, JSON.stringify(await fareQuote(ctx)));
  }

  if (path === '/api/bookings' && method === 'POST') {
    if (!ctx.idempotencyKey) {
      return send(res, 400, JSON.stringify({ error: 'idempotency_key_required', message: 'Send an Idempotency-Key header.' }));
    }
    const r = await postBooking(ctx);
    if (r.replay) res.setHeader('Idempotent-Replay', 'true');
    return send(res, r.status, JSON.stringify(r.body));
  }
  if (path === '/api/bookings' && method === 'GET') {
    return send(res, 200, JSON.stringify(await listBookings(ctx)));
  }
  const bm = /^\/api\/bookings\/(\d{10})$/.exec(path);
  if (bm && method === 'GET') {
    const account = await ctxAccount(ctx);
    const c = await pool.connect();
    try {
      const body = await bookingBody(c, bm[1], account.id);
      return send(res, 200, JSON.stringify(body));
    } finally {
      c.release();
    }
  }
  const cqm = /^\/api\/bookings\/(\d{10})\/cancellation-quote$/.exec(path);
  if (cqm && method === 'POST') {
    const r = await postCancellationQuote(ctx);
    return send(res, r.status, JSON.stringify(r.body));
  }
  const cm = /^\/api\/bookings\/(\d{10})\/cancellations$/.exec(path);
  if (cm && method === 'POST') {
    if (!ctx.idempotencyKey) {
      return send(res, 400, JSON.stringify({ error: 'idempotency_key_required', message: 'Send an Idempotency-Key header.' }));
    }
    const r = await postCancellation(ctx);
    if (r.replay) res.setHeader('Idempotent-Replay', 'true');
    return send(res, r.status, JSON.stringify(r.body));
  }
  const tm = /^\/api\/bookings\/(\d{10})\/tickets\/(\d+)$/.exec(path);
  if (tm && method === 'GET') {
    const r = await downloadTicket(ctx);
    return send(res, r.status, r.body, r.headers);
  }
  const pm = /^\/api\/pnr\/(\d{10})$/.exec(path);
  if (pm && method === 'GET') {
    return send(res, 200, JSON.stringify(await publicPnr(ctx)));
  }

  throw new ApiError(404, 'not_found', 'No such API endpoint.');
}

function setSession(res: http.ServerResponse, sessionId: string): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
