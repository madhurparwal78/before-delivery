// Passboard server entry: applies schema and seed, serves the built client,
// publishes the API and the public packet page, keeps the sweeps running and
// recovers from dependencies that were unreachable at boot without a restart.

import express from 'express';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { initClock, kitchenNow } from './clock.js';
import { applySchemaAndSeed, pool, markDbDown, isDbUp } from './db.js';
import { ApiError, currentUser, sendError } from './http.js';
import { MAX_UPLOAD_BYTES } from '../shared/constants.js';
import { router as kitchenRoutes } from './api/kitchen.js';
import { router as holdsRoutes } from './api/holds.js';
import { router as ledgerRoutes } from './api/ledger.js';
import { router as documentsRoutes } from './api/documents.js';
import { router as packetsRoutes } from './api/packets.js';
import { router as publicRoutes } from './api/public.js';
import { sweep } from './services.js';
import { writeSeedDocumentPdfs } from './seed-objects.js';
import type { Request, Response, NextFunction } from 'express';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = resolve(__dirname, '../../dist');

initClock();
const config = loadConfig();
const app = express();
app.disable('x-powered-by');

// The raw body captured for idempotency, reused by the JSON and upload readers.
declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
  }
}

// ---------------------------------------------------------------------------
// Server boundary: same origin only, published size limits, inert files.
// ---------------------------------------------------------------------------

app.use((req: Request, res: Response, next: NextFunction) => {
  // No cross-origin sharing headers are ever sent.
  const method = req.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const header = req.headers['origin'];
    if (header !== undefined) {
      const host = req.headers['host'];
      if (host && header !== `http://${host}` && header !== `https://${host}`) {
        res.status(403).json({ error: 'cross_origin' });
        return;
      }
    }
  }
  next();
});

// JSON endpoints given another content type answer 415. An absent
// content-type (a bodyless DELETE or empty POST) is always allowed.
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
  if (contentType !== '' && contentType !== 'application/json' && contentType !== 'multipart/form-data') {
    res.status(415).json({ error: 'unsupported_media_type' });
    return;
  }
  next();
});

// A database unreachable at boot, or during the run, answers 503 on every
// route except the health check.
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (!isDbUp() && req.path !== '/health') {
    res.status(503).json({ error: 'database_unavailable' });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// Idempotency: every authenticated POST under /api accepts an
// Idempotency-Key, scoped to the signed-in user and kept at least 24 hours.
// ---------------------------------------------------------------------------

interface StoredResponse {
  status: number;
  body: unknown;
}

function hashBody(raw: Buffer): string {
  return createHash('sha256').update(raw).digest('hex');
}

app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'POST') {
    next();
    return;
  }
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key === '' || !/^[\x20-\x7e]{1,100}$/.test(key)) {
    next();
    return;
  }
  const user = await currentUser(req).catch(() => null);
  if (!user) {
    next();
    return;
  }
  // Capture the raw bytes once; the readers below reuse them. The stream is
  // drained, never destroyed, so a refusal can still be answered.
  const chunks: Buffer[] = [];
  let size = 0;
  const raw = await new Promise<Buffer | null>((resolve) => {
    let refused = false;
    req.on('data', (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        refused = true;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
  if (raw === null) {
    next();
    return;
  }
  req.rawBody = raw;

  const method = req.method;
  const path = req.path;
  const bodyHash = hashBody(raw);
  const existing = await pool.query(
    `SELECT method, path, body_hash, response_body, in_progress FROM idempotency WHERE key = $1 AND user_id = $2`,
    [key, user.id],
  );
  const row = existing.rows[0] as { method: string; path: string; body_hash: string; response_body: StoredResponse | null; in_progress: boolean } | undefined;
  if (row) {
    if (row.in_progress) {
      res.status(409).json({ error: 'request_in_progress' });
      return;
    }
    if (row.method !== method || row.path !== path || row.body_hash !== bodyHash) {
      res.status(422).json({ error: 'idempotency_key_reused' });
      return;
    }
    res.set('Idempotent-Replay', 'true');
    const stored = row.response_body as StoredResponse;
    res.status(stored.status).json(stored.body);
    return;
  }
  const inserted = await pool.query(
    `INSERT INTO idempotency (key, user_id, method, path, body_hash, status, response_body, in_progress, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, NULL, true, $6)
     ON CONFLICT (key, user_id) DO NOTHING`,
    [key, user.id, method, path, bodyHash, new Date(kitchenNow().epochMillis)],
  );
  if ((inserted.rowCount ?? 0) === 0) {
    // A concurrent request with the same key is still running.
    res.status(409).json({ error: 'request_in_progress' });
    return;
  }

  // Capture the response so a replay returns the stored status and body.
  const originalJson = res.json.bind(res);
  let stored: StoredResponse | null = null;
  res.json = (body: unknown) => {
    stored = { status: res.statusCode, body };
    return originalJson(body);
  };
  const originalEnd = res.end.bind(res);
  res.end = ((...args: unknown[]) => {
    if (stored === null) {
      stored = { status: res.statusCode, body: null };
    }
    return (originalEnd as (...a: unknown[]) => unknown)(...args);
  }) as typeof res.end;
  res.on('finish', () => {
    const captured = stored;
    if (captured) {
      void pool
        .query(
          `UPDATE idempotency SET status = $1, response_body = $2, in_progress = false WHERE key = $3 AND user_id = $4`,
          [captured.status, JSON.stringify(captured), key, user.id],
        )
        .catch(() => undefined);
    }
  });
  next();
});

// ---------------------------------------------------------------------------
// Routes.
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', kitchenRoutes);
app.use('/api', holdsRoutes);
app.use('/api', ledgerRoutes);
app.use('/api', documentsRoutes);
app.use('/api', packetsRoutes);
app.use('/', publicRoutes);

// ---------------------------------------------------------------------------
// Static client: only built assets and the routes in this brief are served.
// ---------------------------------------------------------------------------

const INDEX = join(DIST, 'index.html');

const DENIED = [
  '/run.json',
  '/package.json',
  '/package-lock.json',
  '/tsconfig.json',
  '/vite.config.ts',
  '/THIRD_PARTY_NOTICES.md',
];

function deniedPath(p: string): boolean {
  if (p.includes('..')) return true;
  const root = '/' + p.replace(/^\/+/, '').split('/')[0]!;
  if (DENIED.includes(root) || root === '/server' || root === '/client' || root === '/shared' || root === '/node_modules' || root === '/.git' || root === '/.env') return true;
  if (p.startsWith('/.env') || p.startsWith('/.git')) return true;
  return false;
}

function sendIndex(res: Response, status = 200): void {
  res.status(status).set('Cache-Control', 'no-store').sendFile(INDEX);
}

app.get('/packet/:token', (req, res, next) => {
  // An unusable link shows the page with HTTP 404.
  const token = req.params['token'] ?? '';
  void (async () => {
    let valid = false;
    if (/^[A-Za-z0-9_-]{43,}$/.test(token)) {
      try {
        const q = await pool.query(`SELECT status, expires_at FROM packets WHERE token = $1`, [token]);
        const row = q.rows[0] as { status: string; expires_at: Date } | undefined;
        valid = !!row && row.status === 'active' && kitchenNow().epochMillis < row.expires_at.getTime();
      } catch {
        valid = false;
      }
    }
    sendIndex(res, valid ? 200 : 404);
  })().catch(() => next(new ApiError(500, 'internal')));
});

app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const rawPath = req.path;
  if (deniedPath(rawPath)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const relative = rawPath.replace(/^\/+/, '');
  const full = join(DIST, relative);
  if (existsSync(full) && statSync(full).isFile() && full.startsWith(DIST)) {
    res.sendFile(full);
    return;
  }
  sendIndex(res);
});

// ---------------------------------------------------------------------------
// Errors: one shape for every failure.
// ---------------------------------------------------------------------------

const DB_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', '57P01', '57P03', '08006']);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    sendError(res, err);
    return;
  }
  const code = (err as { code?: string } | null)?.code;
  if (code && DB_ERROR_CODES.has(code)) {
    markDbDown();
    void tryApplySchemaLoop();
    res.status(503).json({ error: 'database_unavailable' });
    return;
  }
  res.status(500).json({ error: 'internal' });
});

// ---------------------------------------------------------------------------
// Boot: dependencies unreachable at boot never stop the server.
// ---------------------------------------------------------------------------

let schemaRetryRunning = false;
async function tryApplySchemaLoop(): Promise<void> {
  if (schemaRetryRunning) return;
  schemaRetryRunning = true;
  try {
    await applySchemaAndSeed();
    await writeSeedDocumentPdfs().catch(() => undefined);
  } catch {
    setTimeout(() => {
      schemaRetryRunning = false;
      void tryApplySchemaLoop();
    }, 2000).unref();
  }
}

async function main(): Promise<void> {
  await tryApplySchemaLoop();
  const server = app.listen(config.publicPort, '0.0.0.0', () => {
    console.error(`passboard serving on port ${config.publicPort}`);
  });
  void server;
  // Sweeps run at least every 15 seconds: expiry marks, completion, packets,
  // billing, emails and expiry warnings.
  const timer = setInterval(() => {
    if (!isDbUp()) return;
    void sweep().catch(() => undefined);
  }, 10000);
  timer.unref();
}

void main();
