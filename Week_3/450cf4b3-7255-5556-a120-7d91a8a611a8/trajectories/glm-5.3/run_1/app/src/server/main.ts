import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readConfig } from './config.js';
import { KitchenClock } from './domain/kitchen.js';
import { Deps } from './store.js';
import { applySchema } from './seed.js';
import { handleApi, Router } from './api/routes.js';
import { KillBill } from './billing/killbill.js';
import { ObjectStore } from './storage/s3.js';
import { Mailer, deliverPending } from './mail/queue.js';
import { startSweeper } from './mail/sweeper.js';
import { setSecurityHeaders } from './api/pipeline.js';

const SCREEN_PATHS = new Set(['/board', '/packs', '/documents', '/tenants', '/report', '/receipt', '/signin', '/apply']);

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function main(): Promise<void> {
  const config = readConfig();
  const clock = new KitchenClock(config.kitchenTimeZone);
  // Postgres returns int8 as strings by default; epoch milliseconds always fit
  // a JS number, so every bigint column reads as a number.
  pg.types.setTypeParser(20, (v: string) => Number(v));
  const db = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

  // Schema and seed apply idempotently; provider outages never stop the boot.
  for (let attempt = 0; ; attempt++) {
    try {
      await applySchema(db, config);
      break;
    } catch (e) {
      if (attempt >= 30) throw e;
      process.stderr.write(`schema retry ${attempt}: ${(e as Error).message}\n`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const deps: Deps = { db, config, clock };
  const kb = new KillBill(config);
  const objStore = new ObjectStore(config);
  const mailer = new Mailer(config);
  const router: Router = { deps, kb, store: objStore, mailer };

  await startSweeper(deps, db);
  const deliver = () => deliverPending(db, mailer).catch(() => undefined);
  await deliver();
  setInterval(deliver, 30_000);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.join(here, '..', 'public');

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        const handled = await handleApi(router, req, res, url);
        if (!handled) {
          setSecurityHeaders(res);
          res.setHeader('Cache-Control', 'no-store');
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found', message: "That record isn't available." }));
        }
        return;
      }
      // Only built assets, screen paths and the root answer; nothing else.
      setSecurityHeaders(res);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      if (url.pathname.startsWith('/assets/')) {
        const rel = url.pathname.replace(/^\/assets\//, '');
        const file = path.join(distDir, 'assets', rel);
        const assetsRoot = path.join(distDir, 'assets');
        if (!file.startsWith(assetsRoot) || rel.includes('..')) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        try {
          const data = await fs.promises.readFile(file);
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
          res.end(data);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
        return;
      }
      const screen = '/' + url.pathname.split('/')[1];
      if (url.pathname === '/' || SCREEN_PATHS.has(screen) || SCREEN_PATHS.has(url.pathname)) {
        try {
          const html = await fs.promises.readFile(path.join(distDir, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(html);
        } catch {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Not built');
        }
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      try { res.end(JSON.stringify({ error: 'internal_error', message: 'Something went wrong on our side.' })); } catch { /* closed */ }
    }
  });

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`stationhouse listening on ${config.port}\n`);
  });
}

main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
