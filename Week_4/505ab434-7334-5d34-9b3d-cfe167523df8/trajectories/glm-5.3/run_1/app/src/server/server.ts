import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { readFile as readFileCb } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
const readFileAsync = promisify(readFileCb);
import { loadConfig, publicOrigin, type Config } from './config';
import { applySchema, query, withTransaction, endPool, type Tx } from './db';
import { Router, readBody, readCookies, resolvePrincipal, json, errorResponse, JSON_LIMIT, type Ctx, type Method } from './http';
import { ApiError, crossOrigin, invalidBody, linkExpired, methodNotAllowed, notFound, tooLarge, unauthenticated } from './errors';
import { routeApi, principalBody, asRecord } from './routes-session';
import { routeInvitations } from './routes-invitations';
import { routeLibrary, storageReachable } from './routes-library';
import { routeRequests } from './routes-requests';
import { routeGrants, printMb } from './routes-grants';
import { routeQueue } from './routes-queue';
import { routeAssets, DERIVATIVE_MAX_BYTES } from './routes-assets';
import { routeChapters } from './routes-chapters';
import { routeAudit } from './routes-audit';
import { readClock, writeClock } from './clock';
import { startListener, notify } from './pglisten';
import { S3Client } from './s3client';
import { smtpSend } from './smtp';
import { renderPage, renderErrorPage } from './pages/render';
import { runDueTimers } from './timers';
import { WebSocketServer, type WebSocket } from 'ws';
import { resetAll, seedDatabase, DEMO_SEED, ensureDemoSeed } from './seed';
import { sha256 } from './crypto';
import { decideFor } from './routes-library';
import { loadViewer } from './data';

const clients = new Set<WebSocket>();

async function main(): Promise<void> {
  const cfg = loadConfig();
  const s3 = new S3Client(cfg.s3);

  await waitForDatabase(60);
  await applySchema();
  try {
    await s3.createBucket();
  } catch {
    // MinIO down at boot: the server starts anyway.
  }
  await ensureDemoSeed(cfg, s3);

  const router = new Router();
  const apiRouter = { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => router.add(m, `/api${p}`, h) };
  routeApi(apiRouter, cfg);
  routeInvitations(apiRouter, cfg);
  routeLibrary(apiRouter, cfg);
  routeRequests(apiRouter, cfg);
  routeGrants(apiRouter, cfg, s3);
  routeQueue(apiRouter, cfg);
  routeAssets(apiRouter, cfg, s3);
  routeChapters(apiRouter, cfg);
  routeAudit(apiRouter, cfg);
  registerGradingRoutes(apiRouter, cfg, s3);

  const appOrigin = publicOrigin(cfg);
  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, cfg, router, s3, appOrigin);
    } catch (err) {
      errorResponse(res, err);
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/api/live') {
      socket.destroy();
      return;
    }
    const cookies = readCookies(req.headers.cookie);
    const token = cookies[cfg.sessionCookieName];
    const principal = token ? await resolvePrincipal(req, cfg.sessionCookieName) : null;
    if (!principal) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{"error":"unauthenticated","message":"Sign in to continue."}');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
    });
  });

  await startListener((payload) => {
    for (const client of clients) {
      if (client.readyState === 1) client.send(payload);
    }
  });

  const mailLoop = setInterval(() => void drainOutbox(cfg), 10000);
  const timerLoop = setInterval(() => void tickTimers(cfg), 15000);

  server.listen(cfg.appPublicPort, '0.0.0.0', () => {
    const address = server.address() as AddressInfo;
    console.log(`Rulehouse serving on port ${address.port}`);
  });

  const shutdown = async (): Promise<void> => {
    clearInterval(mailLoop);
    clearInterval(timerLoop);
    server.close();
    await endPool();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

async function waitForDatabase(maxSeconds: number): Promise<void> {
  const started = Date.now();
  while (true) {
    try {
      await query('SELECT 1');
      return;
    } catch (err) {
      if (Date.now() - started > maxSeconds * 1000) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function drainOutbox(cfg: Config): Promise<void> {
  const rows = await query<{ id: string; to_email: string; subject: string; body: string }>(
    `SELECT id, to_email, subject, body FROM mail_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 20`,
  );
  for (const row of rows) {
    try {
      await smtpSend(cfg.smtp.host, cfg.smtp.port, cfg.smtp.from, {
        to: row.to_email,
        subject: row.subject,
        body: row.body,
      });
      await query('UPDATE mail_outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1', [row.id]);
    } catch {
      await query('UPDATE mail_outbox SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    }
  }
}

async function tickTimers(cfg: Config): Promise<void> {
  const now = await readClock(cfg);
  const moved = await runDueTimers(now, cfg);
  if (moved) {
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'library.updated' }));
        client.send(JSON.stringify({ type: 'queue.updated' }));
      }
    }
  }
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: Config,
  router: Router,
  s3: S3Client,
  appOrigin: string,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = (req.method ?? 'GET').toUpperCase() as Method;
  const path = url.pathname;

  if (method !== 'GET' && req.headers.origin !== undefined && req.headers.origin !== appOrigin) {
    throw crossOrigin();
  }

  if (path.startsWith('/api/')) {
    if (auditWrite(method, path)) {
      const principal = await resolvePrincipal(req, cfg.sessionCookieName);
      if (!principal) throw unauthenticated();
      if (principal.role !== 'owner' && principal.role !== 'legal_reviewer') throw notFound();
      throw methodNotAllowed();
    }
    if (path.startsWith('/api/grading/') && !gradingKeyOk(req, cfg)) {
      throw notFound();
    }
    const found = router.find(method, path);
    if (!found) throw notFound();
    const principal = await resolvePrincipal(req, cfg.sessionCookieName);
    const maxBytes = path.includes('/proofs') || path.includes('/derivatives')
      ? Math.max(cfg.proofMaxBytes + 1000000, DERIVATIVE_MAX_BYTES + 1000000)
      : JSON_LIMIT;
    let body: Ctx['body'];
    try {
      body = await readBody(req, maxBytes);
    } catch (err) {
      if (err instanceof ApiError && err.status === 413) throw tooLarge();
      throw err;
    }
    const ctx: Ctx = {
      method,
      path,
      params: found.params,
      url,
      principal,
      body,
      cookies: readCookies(req.headers.cookie),
      setCookies: [],
      req,
      res,
      tx: null,
    };
    try {
      const result = await found.handler(ctx);
      if (isBytesResult(result)) {
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${result.fileName}"`,
        });
        res.end(result.__bytes);
        return;
      }
      if (isCreatedResult(result)) {
        json(res, 201, result.__created, ctx.setCookies);
        return;
      }
      if (result === null || result === undefined) {
        json(res, 204, undefined, ctx.setCookies);
        return;
      }
      json(res, 200, result, ctx.setCookies);
    } catch (err) {
      if (err instanceof ApiError && err.status === 201) {
        json(res, 201, err.message ? safeParse(err.message) : {}, ctx.setCookies);
        return;
      }
      errorResponse(res, err, ctx.setCookies);
    }
    return;
  }

  if (path.startsWith('/dl/')) {
    await serveDownload(path, req, res, cfg, s3);
    return;
  }

  if (path === '/app.js' || path === '/app.css') {
    const filePath = path === '/app.js' ? '/app.js' : '/app.css';
    try {
      const bytes = await readFileAsync(join(process.cwd(), 'public', filePath));
      res.writeHead(200, {
        'content-type': path === '/app.js' ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(bytes);
      return;
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
  }

  if (method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/html; charset=utf-8' });
    res.end();
    return;
  }

  const principal = await resolvePrincipal(req, cfg.sessionCookieName);
  const html = await renderPage(path, principal, cfg);
  if ('redirect' in html) {
    res.writeHead(302, { location: html.redirect });
    res.end();
    return;
  }
  res.writeHead(html.status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html.html);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

interface BytesResult {
  __bytes: Buffer;
  fileName: string;
}

function isBytesResult(value: unknown): value is BytesResult {
  return typeof value === 'object' && value !== null && '__bytes' in value;
}

interface CreatedResult {
  __created: unknown;
}

function created(value: unknown): CreatedResult {
  return { __created: value };
}

function isCreatedResult(value: unknown): value is CreatedResult {
  return typeof value === 'object' && value !== null && '__created' in value;
}

function auditWrite(method: string, path: string): boolean {
  if (method === 'GET') return false;
  return path === '/api/audit' || path.startsWith('/api/audit/');
}

function gradingKeyOk(req: http.IncomingMessage, cfg: Config): boolean {
  const key = req.headers['x-grading-key'];
  return key === cfg.gradingKey;
}

async function serveDownload(
  path: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: Config,
  s3: S3Client,
): Promise<void> {
  const token = path.slice('/dl/'.length);
  const rows = await query<{
    derivative_id: string;
    principal_id: string;
    grant_id: string | null;
    expires_at: Date;
    file_name: string;
    format: string;
    width: number;
    height: number;
    byte_size: string;
    asset_id: string;
    variant_id: string | null;
  }>(
    `SELECT l.derivative_id, l.principal_id, l.grant_id, l.expires_at, d.file_name, d.format, d.width, d.height,
            d.byte_size, d.asset_id, d.variant_id
       FROM download_links l JOIN derivatives d ON d.id = l.derivative_id
      WHERE l.token_hash = $1`,
    [sha256(token)],
  );
  if (rows.length === 0) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage('Not found'));
    return;
  }
  const link = rows[0];
  const principal = await resolvePrincipal(req, cfg.sessionCookieName);
  if (!principal || principal.id !== link.principal_id) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage('Not found'));
    return;
  }
  const now = await readClock(cfg);
  const viewer = await loadViewer(principal);
  const decision = await decideFor(viewer, link.asset_id, link.variant_id, now, cfg);
  if (decision.badge !== 'Available') {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage('Not found'));
    return;
  }
  if (now.getTime() > link.expires_at.getTime()) {
    res.writeHead(410, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage('This link has expired.'));
    return;
  }
  const storageOk = await storageReachable();
  if (!storageOk) {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage('Downloads are unavailable right now.'));
    return;
  }
  const variantKey = link.variant_id
    ? (await query<{ key: string }>('SELECT key FROM variants WHERE id = $1', [link.variant_id]))[0]?.key
    : null;
  const objectKey = `derivatives/${link.asset_id}/${variantKey ? `variants/${variantKey}` : 'base'}/${link.file_name}`;
  const bytes = await s3.get(objectKey);
  if (!bytes) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage('Not found'));
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${link.file_name}"`,
  });
  res.end(bytes);
}

function registerGradingRoutes(
  router: { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => void },
  cfg: Config,
  s3: S3Client,
): void {
  router.add('POST', '/grading/reset', async () => {
    await resetAll(s3);
    const start = new Date(cfg.appStartAt);
    await writeClock(start);
    await ensureSchema();
    return { now: start.toISOString() };
  });

  router.add('POST', '/grading/seed', async (ctx) => {
    const existing = await query<{ c: string }>('SELECT COUNT(*)::text AS c FROM principals');
    if (Number(existing[0]?.c ?? 0) > 0) {
      throw new ApiError(409, 'seed_conflict', 'Reset before seeding.');
    }
    const body = ctx.body.json;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw invalidBody();
    }
    const result = await seedDatabase(body as Parameters<typeof seedDatabase>[0], cfg, s3);
    return created(result);
  });

  router.add('POST', '/grading/clock', async (ctx) => {
    const body = asRecord(ctx.body.json);
    const current = await readClock(cfg);
    let next: Date;
    if (typeof body.setTo === 'string') {
      next = new Date(body.setTo);
    } else if (typeof body.advanceMinutes === 'number') {
      next = new Date(current.getTime() + body.advanceMinutes * 60000);
    } else {
      throw invalidBody();
    }
    await writeClock(next);
    await runDueTimers(next, cfg);
    await withTransaction(async (tx) => {
      await notify(tx, JSON.stringify({ type: 'library.updated' }));
      await notify(tx, JSON.stringify({ type: 'queue.updated' }));
    });
    return { now: next.toISOString() };
  });

  router.add('POST', '/grading/audit/tamper', async (ctx) => {
    const body = asRecord(ctx.body.json);
    const sequence = Number(body.sequence);
    const after = body.after;
    await query('UPDATE audit_records SET after = $2 WHERE sequence = $1', [
      sequence,
      JSON.stringify(after ?? null),
    ]);
    return { sequence };
  });
}

async function ensureSchema(): Promise<void> {
  await applySchema();
}

void crypto;
void printMb;
main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
