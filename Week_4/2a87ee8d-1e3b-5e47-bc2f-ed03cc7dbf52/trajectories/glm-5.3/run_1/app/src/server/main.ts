/** The app entry point: boot, static assets and the API (DP-38, DP-39). */
import * as http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadConfig } from './config.js';
import { Db } from './db.js';
import { KillBillClient } from './killbill.js';
import { createS3Client } from './s3.js';
import { StreamHub } from './streamhub.js';
import { Worker } from './worker.js';
import { handleApi } from './api.js';
import type { Ctx } from './context.js';
import { probeTcp } from './mail.js';

const here = dirname(fileURLToPath(import.meta.url));
// the built client assets live under src/client/dist; serve resolves from the app root
const distDir = process.env.LF_DIST_DIR ?? join(process.cwd(), 'src', 'client', 'dist');
void here;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const db = new Db(cfg.databaseUrl);
  console.log(`[lanternfold] instance ${cfg.instanceId} starting on port ${cfg.port}`);
  const kb = new KillBillClient(cfg);
  const s3 = createS3Client(cfg);
  const hub = new StreamHub();

  const healthy = { killbill: false, minio: false, mail: false, at: 0 };
  // probe services once at boot without blocking it
  void (async () => {
    try {
      await kb.ensureTenantAndCatalog();
      healthy.killbill = true;
    } catch { healthy.killbill = false; }
    healthy.at = Date.now();
    try {
      await s3.ensureBucket();
      healthy.minio = true;
    } catch { healthy.minio = false; }
    healthy.mail = await probeTcp(cfg.smtp.host, cfg.smtp.port);
    healthy.at = Date.now();
  })();

  const ctx: Ctx = { cfg, db, kb, s3, hub, healthy, ready: false };

  // LISTEN/NOTIFY: one dedicated client for change notifications
  const listenerClient = await db.pool.connect();
  hub.attach(listenerClient as unknown as import('pg').Client);
  listenerClient.on('error', () => { /* the pool cleans up; a new listener attaches on restart */ });

  // Postgres at boot: keep retrying; health turns 200 once connected and seeded (DP-39)
  void (async () => {
    await db.waitForDb();
    await db.applySchemaAndSeed();
    ctx.ready = true;
    console.log('[lanternfold] schema and seed applied');
  })().catch((e) => {
    console.error('[lanternfold] init failed', e);
    process.exit(1);
  });

  const worker = new Worker(db, cfg, kb, s3);
  worker.attachHub({
    pushBoardEvent: (workshopId: string, version: number): void => hub.pushBoardEvent(workshopId, version),
  });
  worker.start();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const path = url.pathname;
      if (path.startsWith('/api/')) {
        const handled = await handleApi(req, res, ctx);
        if (!handled) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }));
        }
        return;
      }
      serveStatic(res, path);
    } catch {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'not_found', message: 'Internal error' } }));
      } catch { /* socket gone */ }
    }
  });

  server.listen(cfg.port, '0.0.0.0', () => {
    console.log(`[lanternfold] listening on 0.0.0.0:${cfg.port}`);
  });
}

/** The only paths the server ever serves (DP-39): the app, its assets. */
function serveStatic(res: http.ServerResponse, rawPath: string): void {
  let path = rawPath;
  if (path === '/') {
    sendDistFile(res, 'index.html');
    return;
  }
  if (path === '/styles.css') {
    sendDistFile(res, 'styles.css');
    return;
  }
  if (path.startsWith('/assets/')) {
    const clean = normalize(path).replace(/^(\.\.[/\\])+/, '');
    const file = join(distDir, clean);
    if (!file.startsWith(distDir) || !existsSync(file) || !statSync(file).isFile()) {
      notFound(res);
      return;
    }
    sendFile(res, file);
    return;
  }
  // app routes have no extension; everything else (source, run.json, package.json,
  // lockfiles, .env, source maps) is refused
  if (path.includes('.')) {
    notFound(res);
    return;
  }
  sendDistFile(res, 'index.html');
}

function sendDistFile(res: http.ServerResponse, name: string): void {
  const file = join(distDir, name);
  if (!existsSync(file) || !statSync(file).isFile()) {
    notFound(res);
    return;
  }
  sendFile(res, file);
}

function notFound(res: http.ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end('Not found');
}

function sendFile(res: http.ServerResponse, file: string): void {
  const ext = extname(file).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  const body = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': String(body.length),
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

main().catch((e) => {
  console.error('[lanternfold] fatal', e);
  process.exit(1);
});
