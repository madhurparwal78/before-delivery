import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from './db.js';
import { ApiError, crossOrigin, notFound } from './errors.js';
import { handleApi } from './routes.js';
import { applySchema } from './db.js';
import { seed } from './seed.js';
import { probeStorage, writeFixtureFile, tenantOf } from './storage.js';
import { probeMail, startOutboxLoop } from './mail.js';

const PORT = Number(process.env.APP_PUBLIC_PORT ?? '4173');
const DIST = path.resolve('dist');

const NEVER_SERVED = new Set([
  'run.json', 'package.json', 'package-lock.json', 'tsconfig.json',
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

async function main(): Promise<void> {
  const pool = db();
  await applySchema(pool);
  await seed();
  console.log('[spanwise] schema applied and seed ensured');

  // Probe services at boot; the app serves regardless.
  void probeStorage().then((ok) => console.log('[spanwise] storage probe:', ok ? 'ok' : 'unreachable'));
  void probeMail().then((ok) => console.log('[spanwise] mail probe:', ok ? 'ok' : 'unreachable'));
  setInterval(() => { void probeStorage(); }, 10_000).unref();
  setInterval(() => { void probeMail(); }, 10_000).unref();
  startOutboxLoop();
  fixtureSeedingLoop();

  const server = http.createServer(async (req, res) => {
    try {
      await serve(req, res);
    } catch (err) {
      if (err instanceof ApiError) {
        sendJson(res, err.status, err.body());
      } else {
        console.error('[spanwise] request error', err);
        sendJson(res, 500, { error: { code: 'internal_error', message: 'Something went wrong.' } });
      }
    }
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[spanwise] listening on 0.0.0.0:${PORT}`);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
    ...headers,
  });
  res.end(bytes);
}

async function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  return new Promise((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError(413, 'payload_too_large', 'The request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathName = url.pathname;

  // Cross-origin mutating requests are refused.
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = req.headers.origin;
    if (origin) {
      const allowed = `${process.env.APP_PUBLIC_URL ?? `http://localhost:${PORT}`}`;
      if (origin !== allowed) {
        throw crossOrigin();
      }
    }
  }

  if (pathName === '/api' || pathName.startsWith('/api/')) {
    // Asset upload paths carry file bytes, up to the file limit.
    const isFilePut = method === 'PUT' && /^\/api\/assets\/[^/]+\/files\//.test(pathName);
    const isAssetDeclare = pathName === '/api/corridors/{id}/assets' || (method === 'POST' && /^\/api\/corridors\/[^/]+\/assets$/.test(pathName));
    const limit = isFilePut ? 50_000_000 : isAssetDeclare ? 2_000_000 : 65_536;
    const body = await readBody(req, limit).catch((err) => { throw err; });
    const response = await handleApi(method, pathName, url.searchParams, new Headers(req.headers as Record<string, string>), body);
    const headers = Object.fromEntries(response.headers.entries());
    const buf = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, headers);
    res.end(buf);
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    throw notFound('This does not exist.');
  }

  await serveStatic(pathName, res);
}

async function serveStatic(pathName: string, res: http.ServerResponse): Promise<void> {
  let rel = pathName === '/' ? 'index.html' : pathName.slice(1);
  const clean = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  if (clean.startsWith('..') || path.isAbsolute(clean)) throw notFound('This does not exist.');
  if (NEVER_SERVED.has(clean) || clean.startsWith('src/') || clean.startsWith('node_modules/') || clean.startsWith('.env')) {
    throw notFound('This does not exist.');
  }
  let filePath = path.join(DIST, clean);
  let stat = await fs.stat(filePath).catch(() => null);
  if (stat === null || stat.isDirectory()) {
    // Client routes fall back to the app shell.
    filePath = path.join(DIST, 'index.html');
    stat = await fs.stat(filePath).catch(() => null);
    if (stat === null) throw notFound('This does not exist.');
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  const data = await fs.readFile(filePath);
  res.writeHead(200, { 'content-type': mime, 'content-length': String(data.length), 'cache-control': 'no-store' });
  res.end(data);
}

/**
 * Fixture seeding: seeded assets start pending and become stored only after
 * their generated files are written to object storage and confirmed. Runs
 * whenever storage answers; retries quietly while it does not.
 */
function fixtureSeedingLoop(): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const ok = await seedFixtures();
      if (ok) return; // stop the loop once everything is stored
    } catch (err) {
      console.error('[spanwise] fixture seeding error', err);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => { void tick(); }, 5_000).unref();
}

async function seedFixtures(): Promise<boolean> {
  const pool = db();
  const storageOk = await probeStorage();
  if (!storageOk) return false;
  const pending = await pool.query(
    `SELECT a.id, a.corridor_id, a.kind FROM assets a WHERE a.seeded = true AND a.state = 'pending' ORDER BY a.created_at`
  );
  if (pending.rows.length === 0) return true;
  for (const asset of pending.rows) {
    const tenantId = await tenantOf(pool, String(asset.corridor_id));
    const { fixtureManifest } = await import('../domain/fixtures.js');
    const manifest = fixtureManifest(String(asset.corridor_id), asset.kind as 'terrain' | 'tileset' | 'czml');
    let allOk = true;
    for (const f of manifest) {
      const existing = await pool.query(
        'SELECT state, size_bytes, sha256 FROM asset_files WHERE asset_id=$1 AND path=$2',
        [asset.id, f.path]
      );
      if (existing.rows.length === 0) continue;
      if (existing.rows[0].state === 'stored') continue;
      const written = await writeFixtureFile(tenantId, String(asset.corridor_id), String(asset.id), f.path);
      if (written === null) { allOk = false; break; }
      await pool.query(
        'UPDATE asset_files SET state=$3, size_bytes=$4, sha256=$5 WHERE asset_id=$1 AND path=$2',
        [asset.id, f.path, 'stored', written.size, written.sha256]
      );
    }
    if (!allOk) continue;
    // Confirm the asset with the same rule as uploads.
    const remaining = await pool.query(
      `SELECT count(*)::int AS n FROM asset_files WHERE asset_id=$1 AND state <> 'stored'`,
      [asset.id]
    );
    if (remaining.rows[0].n === 0) {
      const existing = await pool.query('SELECT stored_at FROM assets WHERE id=$1 FOR UPDATE', [asset.id]);
      if (existing.rows[0].stored_at === null) {
        if (asset.kind === 'czml') {
          await parseAndStoreTrack(pool, String(asset.id), String(asset.corridor_id));
        }
        await pool.query(`UPDATE assets SET state='stored', stored_at=now() WHERE id=$1`, [asset.id]);
        console.log(`[spanwise] seeded asset ${asset.id} stored`);
      }
    }
  }
  return false;
}

async function parseAndStoreTrack(pool: import('./db.js').Db, assetId: string, corridorId: string): Promise<void> {
  const { parseCzml, coverageRanges } = await import('../domain/flight.js');
  const { corridorModel } = await import('../domain/corridors.js');
  const { readObject, assetKey } = await import('./storage.js');
  const fileRow = await pool.query(`SELECT path FROM asset_files WHERE asset_id=$1 LIMIT 1`, [assetId]);
  const filePath = String(fileRow.rows[0].path);
  const tenantId = await tenantOf(pool, corridorId);
  const res = await readObject(assetKey(tenantId, corridorId, assetId, filePath));
  if (res === 'unreachable' || res === 'missing') throw new Error('fixture czml missing');
  const model = corridorModel(corridorId);
  if (!model) throw new Error('unknown corridor');
  const parsed = parseCzml(model, res.bytes.toString('utf8'));
  if ('invalid' in parsed && parsed.invalid) throw new Error('fixture czml invalid');
  const track = parsed as import('../domain/flight.js').FlightTrack;
  const coverage = coverageRanges(track);
  await pool.query('DELETE FROM flight_tracks WHERE corridor_id=$1', [corridorId]);
  await pool.query(
    'INSERT INTO flight_tracks (corridor_id, asset_id, epoch_ms, parsed, coverage, parsed_at) VALUES ($1,$2,$3,$4,$5,now())',
    [corridorId, assetId, track.epochMs, JSON.stringify(track), JSON.stringify(coverage)]
  );
}


main().catch((err) => {
  console.error('[spanwise] fatal start error', err);
  process.exit(1);
});
