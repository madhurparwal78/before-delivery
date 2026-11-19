import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db } from './db.js';
import { Services } from './services.js';
import { SCHEMA_SQL } from './schema.js';
import { storageFromEnv, S3 } from './storage.js';
import { readSettings } from '../shared/settings.js';
import { handleApi } from './api.js';
import { handleUpgrade } from './ws.js';
import { ApiError } from './errors.js';
import { now } from './clock.js';
import { applyDeadlines } from './grading.js';
import { saveVersion } from './routes/maps.js';
import { loadMapState } from './context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_CLIENT = path.resolve(__dirname, '../../client');
const JSON_LIMIT = 1_000_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const NEVER_SERVED = new Set(['package.json', 'package-lock.json', 'run.json', 'tsconfig.json']);

function isDotfile(p: string): boolean {
  return p.split('/').some((seg) => seg.startsWith('.'));
}

async function main(): Promise<void> {
  const settings = readSettings();
  const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
  const db = new Db(process.env.DATABASE_URL ?? '');
  let s3: S3 | null = storageFromEnv();
  const svc = new Services(db, settings, s3);
  void s3;

  // The database is applied idempotently on every serve.
  let dbReady = false;
  const connectDb = async (): Promise<void> => {
    for (;;) {
      try {
        await db.query(SCHEMA_SQL);
        dbReady = true;
        svc.dbReady = true;
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };
  void connectDb().then(() => {
    console.log('database ready');
  });

  // Ensure the bucket exists when storage is reachable at boot; the app
  // keeps serving when it is not.
  const ensureBucket = async (): Promise<void> => {
    if (!svc.s3) return;
    try {
      await svc.s3.ensureBucket();
      console.log('storage ready');
    } catch {
      console.log('storage unreachable at boot; serving anyway');
    }
  };
  void ensureBucket();

  // Periodic work: deadlines and automatic versions, on server time.
  const tick = setInterval(() => {
    void (async () => {
      if (!dbReady) return;
      try {
        await applyDeadlines(svc);
        await autoVersions(svc);
        await advanceExports(svc);
      } catch {
        // keep serving
      }
    })();
  }, 1000);
  tick.unref();

  const server = http.createServer((req, res) => {
    void handle(req, res, svc, () => dbReady);
  });
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.endsWith('/live')) {
        const cookies = parseCookies(req.headers.cookie ?? '');
        const origin = req.headers.origin ?? null;
        const host = req.headers.host ?? 'localhost';
        if (origin && !sameOrigin(origin, host)) {
          socket.destroy();
          return;
        }
        await handleUpgrade(svc, req, socket, head, cookies);
        return;
      }
      socket.destroy();
    })();
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`sprigmap serving on 0.0.0.0:${port}`);
  });
}

function sameOrigin(origin: string, host: string): boolean {
  try {
    const u = new URL(origin);
    return u.host === host;
  } catch {
    return false;
  }
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

async function readBody(req: http.IncomingMessage, limit: number): Promise<{ ok: boolean; bytes: Buffer | null }> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > limit) return { ok: false, bytes: null };
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        resolve({ ok: false, bytes: null });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) resolve({ ok: true, bytes: Buffer.concat(chunks) });
    });
    req.on('error', () => {
      if (!done) resolve({ ok: false, bytes: null });
    });
  });
}

interface AuthInfo {
  user: { id: string; username: string } | null;
  guest: { token: string; username: string; role: string; mapId: string } | null;
}

async function authenticate(svc: Services, cookies: Record<string, string>): Promise<AuthInfo> {
  if (cookies.sprig_session) {
    const row = await svc.db.one<{ id: string; username: string; expires_at: Date }>(
      'SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1',
      [cookies.sprig_session],
    );
    if (row) {
      if (row.expires_at.getTime() > now().getTime()) {
        return { user: { id: row.id, username: row.username }, guest: null };
      }
      // expired: open sockets hear about it through applyDeadlines
    }
  }
  if (cookies.sprig_guest) {
    const g = await svc.db.one<{ token: string; username: string; role: string; map_id: string }>(
      'SELECT token, username, role, map_id FROM guests WHERE token = $1', [cookies.sprig_guest],
    );
    if (g) return { user: null, guest: { token: g.token, username: g.username, role: g.role, mapId: g.map_id } };
  }
  return { user: null, guest: null };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, svc: Services, dbReady: () => boolean): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  const method = (req.method ?? 'GET').toUpperCase();
  const cookies = parseCookies(req.headers.cookie ?? '');
  const origin = req.headers.origin ?? null;

  res.setHeader('content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');

  // One origin: state-changing cross-origin requests are refused.
  const stateChanging = method !== 'GET' && method !== 'HEAD' && p !== '/api/health';
  if (origin && stateChanging) {
    const host = req.headers.host ?? '';
    if (!sameOrigin(origin, host)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'forbidden', message: 'Cross-origin requests are refused.' }));
      return;
    }
  }

  if (p.startsWith('/api/')) {
    if (p === '/api/health' && !dbReady()) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'starting' }));
      return;
    }
    const auth = await authenticate(svc, cookies);
    const raw = await readBody(req, JSON_LIMIT);
    if (!raw.ok) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'too_large', message: 'The body is too large.' }));
      return;
    }
    let body: unknown = null;
    const ct = req.headers['content-type'] ?? '';
    if ((ct.includes('application/json') || ct === '') && raw.bytes && raw.bytes.length > 0) {
      try {
        body = JSON.parse(raw.bytes.toString('utf8'));
      } catch {
        res.writeHead(422, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'invalid', message: 'The body is not valid JSON.' }));
        return;
      }
    }
    await handleApi({
      req, res, method, path: p, query: url.searchParams, params: {}, cookies,
      user: auth.user, guest: auth.guest, body, rawBody: raw.bytes, origin,
    }, svc);
    return;
  }

  // static assets
  await serveStatic(p, res);
}

async function serveStatic(p: string, res: http.ServerResponse): Promise<void> {
  const clean = p.split('?')[0].replace(/\/+$/, '') || '/';
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
  if (NEVER_SERVED.has(rel) || isDotfile(rel) || rel.endsWith('.env') || rel.includes('..')) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const file = path.join(DIST_CLIENT, rel);
  if (!file.startsWith(DIST_CLIENT)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const data = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': data.length,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(data);
  } catch {
    // SPA fallback for client routes
    try {
      const index = await readFile(path.join(DIST_CLIENT, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(index);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  }
}

/** Automatic versions: one interval from the latest version baseline. */
async function autoVersions(svc: Services): Promise<void> {
  const maps = await svc.db.query<{ id: string; version_baseline: Date; revision: string; owner_id: string }>(
    'SELECT id, version_baseline, revision, owner_id FROM maps',
  );
  const t = now().getTime();
  for (const m of maps.rows) {
    if (t - m.version_baseline.getTime() < svc.settings.version_interval_ms) continue;
    const latest = await svc.db.one<{ revision: string }>('SELECT revision FROM versions WHERE map_id = $1 ORDER BY number DESC LIMIT 1', [m.id]);
    const lastRev = latest ? Number(latest.revision) : 0;
    if (Number(m.revision) === lastRev) {
      // nothing changed: move the baseline and try again next interval
      await svc.db.query('UPDATE maps SET version_baseline = $2 WHERE id = $1', [m.id, new Date(t).toISOString()]);
      continue;
    }
    const lastOp = await svc.db.one<{ author: string }>('SELECT author FROM op_log WHERE map_id = $1 ORDER BY seq DESC LIMIT 1', [m.id]);
    const by = lastOp?.author ?? 'system';
    const version = await saveVersion(svc, m.id, by, `Version ${Number(m.revision)}`, 'auto');
    // A failed cut also moves the baseline to the attempt instant.
    await svc.db.query('UPDATE maps SET version_baseline = $2 WHERE id = $1', [m.id, new Date(t).toISOString()]);
    if (version) svc.hub.broadcast(m.id, 'version', { version });
  }
}

/** Export jobs advance by the step interval: 20, 40, 60, 80, then write. */
async function advanceExports(svc: Services): Promise<void> {
  const rows = await svc.db.query<{ id: string; map_id: string; state: string; progress: number; format: string; topic_id: string | null; next_step_at: Date }>(
    "SELECT id, map_id, state, progress, format, topic_id, next_step_at FROM exports WHERE state IN ('queued','running') AND next_step_at <= $1",
    [new Date(now().getTime()).toISOString()],
  );
  for (const row of rows.rows) {
    const next = Number(row.progress) + 20;
    if (next < 100) {
      await svc.db.query('UPDATE exports SET state = $2, progress = $3, next_step_at = $4 WHERE id = $1', [
        row.id, 'running', next, new Date(now().getTime() + svc.settings.export_step_ms).toISOString(),
      ]);
      svc.hub.broadcast(row.map_id, 'export', { export: { id: row.id, state: 'running', progress: next, format: row.format, download_url: null } });
      continue;
    }
    // write step
    const loaded = await loadMapState(svc.db, row.map_id);
    const state = loaded.state;
    const { topicsToOutline, serialiseOutline } = await import('../shared/outline.js');
    const { svgFor } = await import('./svg.js');
    const { exportKey, storageCall } = await import('./storage.js');
    const { asTopicNode } = await import('./routes/maps.js');
    const nodes = [...state.topics.values()].map(asTopicNode);
    let bytes: Buffer;
    let contentType: string;
    if (row.format === 'sprig') {
      const roots = topicsToOutline(nodes, row.topic_id ?? null);
      bytes = serialiseOutline(roots, row.topic_id === null);
      contentType = 'text/plain; charset=utf-8';
    } else {
      bytes = Buffer.from(svgFor(nodes, state.layout), 'utf8');
      contentType = 'image/svg+xml';
    }
    const stored = await storageCall({ s3: svc.s3, down: svc.storageDown }, (s3) => s3.put(exportKey(row.map_id, row.id, row.format as 'sprig' | 'svg'), bytes, contentType));
    if (stored?.ok) {
      await svc.db.query("UPDATE exports SET state = 'ready', progress = 100, next_step_at = NULL WHERE id = $1", [row.id]);
      svc.hub.broadcast(row.map_id, 'export', { export: { id: row.id, state: 'ready', progress: 100, format: row.format, download_url: `/api/exports/${row.id}/download` } });
    } else {
      await svc.db.query("UPDATE exports SET state = 'failed', progress = 80, next_step_at = NULL WHERE id = $1", [row.id]);
      svc.hub.broadcast(row.map_id, 'export', { export: { id: row.id, state: 'failed', progress: 80, format: row.format, download_url: null } });
    }
  }
}

void ApiError;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
