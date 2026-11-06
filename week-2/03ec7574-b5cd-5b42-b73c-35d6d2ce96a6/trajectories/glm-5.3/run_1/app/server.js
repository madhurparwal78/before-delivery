import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { poolRef, withClient, markReady, markReachable } from './lib/db.js';
import { applySchema, seed } from './lib/seed.js';
import { applyExpiry } from './lib/intents.js';
import { handleApi } from './api/dispatch.js';
import { renderPage } from './pages/render.js';
import { notFoundPageHtml } from './pages/public.js';

const PORT = Number(process.env.APP_PUBLIC_PORT || 4173);
const BOOT_RETRY_MS = 2000;
const SWEEP_MS = 3000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, 'pages', 'assets');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const STATIC_FILES = new Set(['style.css', 'app.js', 'console.js']);

async function boot() {
  let attempts = 0;
  for (;;) {
    try {
      const client = await poolRef().connect();
      try {
        await applySchema(client);
        const seeded = await seed(client);
        if (seeded) console.log('corvo: seed written');
        markReady(true);
        markReachable(true);
        console.log(`corvo: ready (attempt ${attempts + 1})`);
        return;
      } finally {
        client.release();
      }
    } catch (e) {
      attempts += 1;
      console.log(`corvo: database not ready (${e.message}); retrying in 2s`);
      await new Promise((r) => setTimeout(r, BOOT_RETRY_MS));
    }
  }
}

setInterval(() => {
  withClient((client) => applyExpiry(client, new Date())).catch(() => {});
}, SWEEP_MS);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const query = url.searchParams;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, query);
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/assets/')) {
      const name = pathname.slice('/assets/'.length);
      const file = path.normalize(path.join(ASSETS, name));
      if (!file.startsWith(ASSETS) || !STATIC_FILES.has(path.basename(file)) || !existsSync(file)) {
        notFoundPage(res);
        return;
      }
      const body = readFileSync(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      notFoundPage(res);
      return;
    }

    await renderPage(req, res, pathname, query);
  } catch (e) {
    if (/ECONNRESET|EPIPE/.test(e?.message || '')) return;
    try {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Corvo</title><p>Something went wrong.</p>');
    } catch {}
  }
});

function notFoundPage(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(notFoundPageHtml());
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`corvo: listening on 0.0.0.0:${PORT}`);
  boot();
});
