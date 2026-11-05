import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { config } from './util.js';
import { Router, runHandler } from './http.js';
import { registerPublicRoutes, registerQuoteRoutes, registerSessionRoutes } from './api-public.js';
import { registerOrderRoutes } from './api-orders.js';
import { registerPlanRoutes } from './api-plan.js';
import { registerPortalRoutes } from './api-portal.js';
import { registerInvoiceRoutes, registerStudioRoutes } from './api-studio.js';
import { registerPageRoutes } from './pages.js';
import { ensureSeeded } from './seed.js';
import { startMailWorker } from './mailqueue.js';
import { startPdfWorker } from './pdf.js';
import { startDunningWorker } from './dunning.js';

const router = new Router();
registerPublicRoutes(router);
registerQuoteRoutes(router);
registerSessionRoutes(router);
registerOrderRoutes(router);
registerPlanRoutes(router);
registerPortalRoutes(router);
registerInvoiceRoutes(router);
registerStudioRoutes(router);
registerPageRoutes(router);

const MIME: Record<string, string> = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serveStatic(pathname: string): { bytes: Buffer; contentType: string } | null {
  if (!pathname.startsWith('/assets/')) return null;
  const safe = pathname.replace(/\.\./g, '');
  const path = `public${safe}`;
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  const extension = path.slice(path.lastIndexOf('.'));
  return { bytes, contentType: MIME[extension] ?? 'application/octet-stream' };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  try {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/download/')) {
      const handled = await runHandler(router, req, res, url);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found', message: 'We could not find that.' }));
      }
      return;
    }
    const asset = serveStatic(url.pathname);
    if (asset) {
      res.writeHead(200, {
        'Content-Type': asset.contentType,
        'Content-Length': asset.bytes.length.toString(),
        'Cache-Control': 'public, max-age=60',
      });
      res.end(asset.bytes);
      return;
    }
    if (url.pathname.startsWith('/assets/')) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body><h1>We couldn't find that page.</h1></body></html>`);
      return;
    }
    const handled = await runHandler(router, req, res, url);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title><link rel="stylesheet" href="/assets/app.css"></head><body><main id="content"><section><h1>We couldn't find that page.</h1><p><a href="/">Go home</a></p></section></main></body></html>`);
    }
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><h1>Something went wrong.</h1></body></html>');
    }
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Pampero Ledger listening on 0.0.0.0:${config.port}`);
});

void (async () => {
  await ensureSeeded();
  startMailWorker();
  startPdfWorker();
  startDunningWorker();
})();
