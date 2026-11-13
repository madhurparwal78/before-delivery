import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig } from './config.js';
import { pool, applySchema, seed } from './db.js';
import { HttpError } from './errors.js';
import { matchRoute, loadSessionPerson } from './api.js';
import { serverDate, formatInstant } from './time.js';
import { subscribe, eventsSince, latestSeq, type LiveEvent } from './events.js';
import { registerSocket } from './liveSockets.js';
import { readGrants } from './grantReader.js';
import { emitFor } from './events.js';

import './routes-core.js';
import './routes-grants.js';
import './routes-exercises.js';
import './routes-tenders.js';
import './routes-admin.js';

const config = loadConfig();
const app = express();
const server = http.createServer(app);

const MAX_BODY = 65_536;

// ---------- body handling with the published limits ----------

app.use((req: Request, res: Response, next: () => void) => {
  const hasBody = (req.headers['content-length'] !== undefined && Number(req.headers['content-length']) > 0)
    || req.headers['transfer-encoding'] === 'chunked';
  const method = req.method.toUpperCase();
  const mutatingWithBody = hasBody && !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (mutatingWithBody) {
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') {
      res.status(415).json({ error: { code: 'unsupported_media_type', message: 'Send a JSON body.' } });
      return;
    }
  }
  next();
});

app.use(express.json({
  limit: MAX_BODY,
  type: () => true,
  strict: true,
}));

app.use((err: unknown, _req: Request, res: Response, next: () => void) => {
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: { code: 'bad_json', message: 'Send a well-formed JSON body.' } });
    return;
  }
  const anyErr = err as { type?: string; statusCode?: number; status?: number; message?: string };
  if (anyErr?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'That body is too large.' } });
    return;
  }
  if (anyErr?.type === 'entity.parse.failed' || anyErr?.statusCode === 400 || anyErr?.status === 400) {
    res.status(400).json({ error: { code: 'bad_json', message: 'Send a well-formed JSON body.' } });
    return;
  }
  next();
});

app.use(cookieParser());

// ---------- static assets: only built browser assets ----------

const DIST = path.join(process.cwd(), 'dist', 'browser');
const ASSETS = path.join(process.cwd(), 'assets');

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function serveStaticFile(res: Response, file: string): void {
  const full = path.join(DIST, file);
  if (!full.startsWith(DIST)) return;
  if (!fs.existsSync(full)) return;
  res.setHeader('Content-Type', mimeTypes[path.extname(full)] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.send(fs.readFileSync(full));
}

function serveAsset(res: Response, rel: string): void {
  const full = path.join(ASSETS, rel);
  if (!full.startsWith(ASSETS)) return;
  if (!fs.existsSync(full)) return;
  res.setHeader('Content-Type', mimeTypes[path.extname(full)] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.send(fs.readFileSync(full));
}

// ---------- same-origin guard on state-changing requests ----------

app.use((req: Request, res: Response, next: () => void) => {
  const origin = req.header('Origin');
  const host = req.header('Host');
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        if (mutating) {
          res.status(403).json({ error: { code: 'forbidden', message: 'Your origin may not change this register.' } });
          return;
        }
      }
    } catch {
      if (mutating) {
        res.status(403).json({ error: { code: 'forbidden', message: 'Your origin may not change this register.' } });
        return;
      }
    }
  }
  void next;
  next();
});

// ---------- health, then the API ----------

let dbReady = false;

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/api', async (req: Request, res: Response) => {
  if (!dbReady) {
    res.status(503).json({ error: { code: 'register_unavailable', message: 'The register is not reachable yet. Try again shortly.' } });
    return;
  }
  // req.path is relative to this mount; use the full pathname.
  const fullPath = new URL(req.originalUrl, `http://${req.headers.host ?? 'localhost'}`).pathname;
  const match = matchRoute(req.method, fullPath);
  if (!match) {
    res.status(404).json({ error: { code: 'not_found', message: "This record isn't on your register." } });
    return;
  }
  const person = await loadSessionPerson(req);
  if (match.roles !== 'anyone' && !person) {
    res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in to see your register.' } });
    return;
  }
  if (match.roles !== 'anyone' && match.roles !== 'signed-in') {
    const roles = match.roles;
    if (!roles.includes(person!.role)) {
      res.status(403).json({ error: { code: 'forbidden', message: 'Your role may not do this.' } });
      return;
    }
  }
  try {
    const client = await pool.connect();
    try {
      const result = await match.handler({
        req, res, person: person!, client, params: match.params, body: req.body,
      });
      if (result && typeof result === 'object' && '__status' in (result as Record<string, unknown>)) {
        const wrapped = result as { __status: number; body: unknown };
        res.status(wrapped.__status).json(wrapped.body);
      } else if (result !== undefined && !res.writableEnded) {
        res.json(result);
      }
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof HttpError) {
      const body: Record<string, unknown> = { error: { code: err.code, message: err.message } };
      if (err.fields) body.fields = err.fields;
      if (err.extra) Object.assign(body, err.extra);
      if (!res.writableEnded) res.status(err.status).json(body);
    } else {
      console.error(err);
      if (!res.writableEnded) {
        res.status(500).json({
          error: { code: 'internal_error', message: 'Something went wrong on our side. Your register has not changed.' },
        });
      }
    }
  }
});

// ---------- pages ----------

// Only these paths are served to the browser; everything else answers 404.
const PAGE_PATHS = new Set([
  '/', '/grants', '/exercise', '/exercises', '/documents', '/cap-table',
  '/tenders', '/board', '/removed',
  '/admin/grants', '/admin/valuations', '/admin/ledger',
  '/admin/tenders', '/admin/scenario', '/admin/people',
]);

const BLOCKED_FILES = /\.(ts|tsx|sql|map|env|md|json|lock|mjs)$/i;

app.use((req: Request, res: Response) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(404).json({ error: { code: 'not_found', message: "This record isn't on your register." } });
    return;
  }
  if (req.path.startsWith('/assets/')) {
    serveAsset(res, req.path.slice('/assets/'.length));
    return;
  }
  if (req.path === '/app.js' || req.path === '/app.css' || req.path === '/favicon.svg') {
    serveStaticFile(res, req.path.slice(1));
    return;
  }
  // Never serve source files, the manifest, lockfiles or anything outside the built assets.
  if (BLOCKED_FILES.test(req.path) || req.path.startsWith('/src/') || req.path.startsWith('/scripts/')) {
    res.status(404).json({ error: { code: 'not_found', message: "This record isn't on your register." } });
    return;
  }
  const base = '/' + (req.path.split('/')[1] ?? '');
  const second = '/' + [req.path.split('/')[1], req.path.split('/')[2]].filter(Boolean).join('/');
  if (PAGE_PATHS.has(base) || PAGE_PATHS.has(second)) {
    serveStaticFile(res, 'index.html');
    return;
  }
  res.status(404).json({ error: { code: 'not_found', message: "This record isn't on your register." } });
});

// ---------- WebSocket: one socket per page, server-to-client only ----------

const wss = new WebSocketServer({ noServer: true });

interface SocketState {
  personId: string;
  lastSeq: number;
}

declare module 'ws' {
  interface WebSocket {
    holdfast?: SocketState;
  }
}

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
  }
  const cookieHeader = req.headers.cookie ?? '';
  const tokenMatch = /(?:^|;\s*)holdfast_session=([^;]+)/.exec(cookieHeader);
  const token = tokenMatch?.[1];
  const url = new URL(req.url ?? '/api/live', `http://${req.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/api/live')) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  void (async () => {
    if (!dbReady || !token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const r = await pool.query(
      `SELECT p.id FROM sessions s JOIN people p ON p.id = s.person_id
       WHERE s.token = $1 AND p.access = 'active'`,
      [token],
    );
    const personId = r.rows[0]?.id as string | undefined;
    if (!personId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const sinceRaw = url.searchParams.get('since');
      const since = sinceRaw !== null && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : null;
      ws.holdfast = { personId, lastSeq: since ?? 0 };
      void (async () => {
        // Replay every event the page missed.
        if (since !== null) {
          const missed = await eventsSince(personId, since);
          for (const ev of missed) {
            ws.send(JSON.stringify({ seq: ev.seq, type: ev.type, at: ev.at.toISOString(), data: ev.data }));
            ws.holdfast!.lastSeq = ev.seq;
          }
        }
        const latest = await latestSeq(personId);
        ws.send(JSON.stringify({ seq: 'hello', latest_seq: latest, server_time: new Date().toISOString(), type: 'hello', at: new Date().toISOString(), data: null }));
      })();

      const unsubscribeSubscribe = subscribe(personId, (event: LiveEvent) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ seq: event.seq, type: event.type, at: event.at.toISOString(), data: event.data }));
        ws.holdfast!.lastSeq = event.seq;
      });
      const unregister = registerSocket(personId, ws);
      ws.on('close', () => {
        unregister();
        unsubscribeSubscribe();
      });
      ws.on('message', () => {
        // The page sends nothing over the socket.
      });
    });
  })();
});

// ---------- the clock and the scheduler ----------

const clockTimer: NodeJS.Timeout = setInterval(() => {
  const now = new Date();
  const message = JSON.stringify({ type: 'clock', seq: null, at: now.toISOString(), data: { server_time: now.toISOString() } });
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN && ws.holdfast) {
      ws.send(message);
    }
  }
}, 1_000);
void clockTimer;

// ---------- scheduled register work (expiry, windows, closes, vesting) ----------

/** Sends a timed notice exactly once; returns true when this call is the first. */
async function notifyOnce(
  client: import('pg').PoolClient,
  subject: string,
  kind: string,
): Promise<boolean> {
  const r = await client.query(
    'INSERT INTO sent_notifications (subject, kind) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [subject, kind],
  );
  return (r.rowCount ?? 0) > 0;
}

async function sweep(): Promise<void> {
  const now = new Date();
  const client = await pool.connect();
  try {
    // Offer expiry
    const expired = await client.query(
      "SELECT id, holder_id FROM grants WHERE state = 'offered' AND offer_expires_at <= $1",
      [now],
    );
    for (const g of expired.rows as Array<{ id: string; holder_id: string }>) {
      await client.query('BEGIN');
      try {
        await client.query("UPDATE grants SET state = 'expired' WHERE id = $1 AND state = 'offered'", [g.id]);
        const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
        for (const a of admins.rows) await emitFor(client, a.id, 'grant_state', { grant_id: g.id, state: 'expired' });
        await emitFor(client, g.holder_id, 'grant_state', { grant_id: g.id, state: 'expired' });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    // Offer warnings, each announced once.
    const cfg = config;
    const warn = await client.query<{ id: string; holder_id: string; offer_expires_at: Date }>(
      "SELECT id, holder_id, offer_expires_at FROM grants WHERE state = 'offered'",
    );
    for (const g of warn.rows) {
      const warningAt = new Date(g.offer_expires_at.getTime() - cfg.offerWarningSeconds * 1000);
      if (now >= warningAt) {
        await client.query('BEGIN');
        try {
          if (await notifyOnce(client, g.id, 'offer_warning')) {
            await emitFor(client, g.holder_id, 'offer_warning', { grant_id: g.id, expires_at: g.offer_expires_at.toISOString() });
          }
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      }
    }
    // Leaver window warnings, each announced once per warning time.
    const leavers = await client.query<{ id: string; window_ends_at: Date }>(
      "SELECT id, window_ends_at FROM people WHERE role = 'leaver' AND window_ends_at > $1",
      [now],
    );
    for (const p of leavers.rows) {
      for (const [i, secs] of cfg.leaverWarningsSeconds.entries()) {
        const at = new Date(p.window_ends_at.getTime() - secs * 1000);
        if (now >= at) {
          await client.query('BEGIN');
          try {
            if (await notifyOnce(client, `${p.id}:${i}`, 'window_warning')) {
              await emitFor(client, p.id, 'window_warning', {
                person_id: p.id,
                window_ends_at: p.window_ends_at.toISOString(),
                seconds: secs,
              });
            }
            await client.query('COMMIT');
          } catch (e) {
            await client.query('ROLLBACK');
            throw e;
          }
        }
      }
    }
    // Leaver window ends: cancel every remaining exercisable option once.
    const ended = await client.query(
      `SELECT p.id AS person_id FROM people p
       WHERE p.role = 'leaver' AND p.window_ends_at <= $1`,
      [now],
    );
    for (const p of ended.rows as Array<{ person_id: string }>) {
      await client.query('BEGIN');
      try {
        if (await notifyOnce(client, p.person_id, 'window_ended')) {
          await client.query('COMMIT');
          await cancelLeaverOptions(p.person_id);
        } else {
          await client.query('COMMIT');
        }
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    // Tender close
    const closing = await client.query(
      "SELECT id FROM tenders WHERE state = 'open' AND closes_at <= $1",
      [now],
    );
    for (const t of closing.rows as Array<{ id: string }>) {
      await closeTender(t.id);
    }
  } finally {
    client.release();
  }
}

async function cancelLeaverOptions(personId: string): Promise<void> {
  const client = await pool.connect();
  const now = new Date();
  try {
    await client.query('BEGIN');
    try {
      const person = await client.query(
        'SELECT id, name, window_ends_at, terminated_at FROM people WHERE id = $1',
        [personId],
      );
      const p = person.rows[0] as { id: string; name: string; window_ends_at: Date; terminated_at: Date } | undefined;
      if (!p || p.window_ends_at > now) {
        await client.query('COMMIT');
        return;
      }
      const grants = await readGrants(client, "g.holder_id = $1 AND g.state = 'accepted'", [personId]);
      let totalCancelled = 0;
      for (const g of grants) {
        const exercisedR = await client.query<{ total: string }>(
          "SELECT coalesce(sum(options),0)::text AS total FROM exercise_orders WHERE grant_id = $1 AND state = 'issued'",
          [g.id],
        );
        const exercised = Number(exercisedR.rows[0]?.total ?? 0);
        const openR = await client.query<{ total: string }>(
          "SELECT coalesce(sum(options),0)::text AS total FROM exercise_orders WHERE grant_id = $1 AND state IN ('pending','held')",
          [g.id],
        );
        const open = Number(openR.rows[0]?.total ?? 0);
        // At the window end, cancel every remaining exercisable option not held
        // in an open order: vested − exercised − already cancelled − open orders.
        const cancel = Math.max(0, (Number(g.options) - Number(g.forfeited)) - exercised - Number(g.cancelled) - open);
        if (cancel > 0) {
          await client.query('UPDATE grants SET cancelled = cancelled + $1 WHERE id = $2', [cancel, g.id]);
          await writeLedgerEntryRef(client, {
            holder_id: personId, holder_name: p.name, kind: 'options_cancelled', class: 'Options',
            shares_delta: 0, options_delta: -cancel, reference: `${g.id} window end`,
          });
          totalCancelled += cancel;
        }
      }
      await emitFor(client, personId, 'window_ended', {
        cancelled: totalCancelled,
        window_ends_at: p.window_ends_at.toISOString(),
      });
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'cap_table_changed', {});
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

import { writeLedgerEntry } from './ledger.js';
function writeLedgerEntryRef(client: import('pg').PoolClient, entry: Parameters<typeof writeLedgerEntry>[1]) {
  return writeLedgerEntry(client, entry);
}

async function closeTender(tenderId: string): Promise<void> {
  const { allocateTender } = await import('./tenderAllocation.js');
  await allocateTender(tenderId);
}

setInterval(() => {
  void sweep().catch((e) => console.error(e));
}, 500);

// ---------- start ----------

async function start(): Promise<void> {
  // Keep trying Postgres every 2 seconds.
  const tryDb = async (): Promise<void> => {
    try {
      await pool.query('SELECT 1');
      dbReady = true;
    } catch {
      dbReady = false;
      setTimeout(tryDb, 2_000);
    }
  };
  await tryDb();
  if (dbReady) {
    await applySchema();
    await seed();
    console.log(`Register ready. Server date ${serverDate(new Date())}.`);
  }
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Holdfast Register serving on port ${config.port}`);
  });
}

void start();
void formatInstant;
void crypto;
export { app, server };
