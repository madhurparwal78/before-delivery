// Plumbline server: API, published pages, static built assets.

import express, { type Request, type Response, type NextFunction, type Express } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, type Config } from './lib/config.js';
import { applySchema, pool } from './lib/db.js';
import { ApiError } from './lib/errors.js';
import { Storage } from './lib/s3.js';
import { KillBill, KillBillUnavailable } from './lib/killbill.js';
import { startDeliveryLoop } from './lib/outbox.js';
import { seed } from './seed.js';
import { registerApi } from './api/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const config: Config = loadConfig();
export const storage = new Storage(config.s3);
export const killbill = new KillBill(config.killbill);

const JSON_LIMIT = 65_536;

export async function main(): Promise<void> {
  // Postgres must be reachable before serving; keep retrying every 2 seconds.
  let ready = false;
  while (!ready) {
    try {
      await applySchema();
      await seed(storage);
      ready = true;
    } catch (error) {
      console.error('startup waiting for postgres:', (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const app: Express = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  // Health: the one endpoint exempt from the error body shape.
  let healthOk = true;
  app.get('/api/health', (_req, res) => {
    if (healthOk) {
      res.status(200).json({ status: 'ok' });
    } else {
      res.status(503).json({ status: 'starting' });
    }
  });
  void pool.query('SELECT 1').catch(() => {
    healthOk = false;
  });
  const healthWatcher = setInterval(() => {
    pool
      .query('SELECT 1')
      .then(() => {
        healthOk = true;
      })
      .catch(() => {
        healthOk = false;
      });
  }, 2000);
  healthWatcher.unref();

  registerApi(app, config);

  // Static assets (built browser app, fonts, icons).
  const publicDir = join(__dirname, '../../public');
  app.use(express.static(publicDir, { index: false, fallthrough: true, maxAge: '1h' }));

  // Procedural covers: published case studies only; withdrawn ones answer 404.
  const { coverSvg } = await import('./covers.js');
  const { one } = await import('./lib/db.js');
  app.get('/media/covers/:slug.svg', async (req, res) => {
    const row = await one<{ state: string }>('SELECT state FROM case_studies WHERE slug = $1', [req.params.slug]);
    if (!row || row.state !== 'published') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(coverSvg(req.params.slug));
  });

  // Page routes: serve the shell; the client renders and the server marks 404s.
  const shell = readFileSync(join(publicDir, 'index.html'), 'utf8');
  const notFoundShell = shell.replace(
    '<body data-shell>',
    '<body data-shell data-prerender-404>',
  );
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const notFound = isUnknownPagePath(req.path);
    if (notFound) {
      res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(notFoundShell);
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(shell);
  });

  // One error mechanism for every endpoint.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof ApiError) {
      res.status(error.status).json(error.body);
      return;
    }
    if (error instanceof KillBillUnavailable) {
      res.status(503).json({ error: 'billing_unavailable' });
      return;
    }
    const anyError = error as { type?: string; statusCode?: number; limitBytes?: number };
    if (anyError && anyError.type === 'entity.too.large') {
      const limit = typeof anyError.limitBytes === 'number' ? anyError.limitBytes : JSON_LIMIT;
      res.status(413).json({ error: 'body_too_large', limitBytes: limit });
      return;
    }
    if (anyError && anyError.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'bad_request' });
      return;
    }
    if (anyError && anyError.type === 'multipart.error') {
      res.status(400).json({ error: 'bad_request' });
      return;
    }
    console.error('unhandled', error);
    res.status(500).json({ error: 'internal' });
  });

  startDeliveryLoop(config.smtp.host, config.smtp.port);

  const server = app.listen(config.port, '0.0.0.0');
  server.keepAliveTimeout = 65_000;
  console.log(`plumbline serving on 0.0.0.0:${config.port}`);
}

const PAGE_PATHS = new Set<string>([
  '/', '/work', '/start', '/sign-in', '/office', '/office/members', '/office/case-studies', '/office/enquiries',
]);

export function isUnknownPagePath(path: string): boolean {
  if (PAGE_PATHS.has(path)) return false;
  if (path === '/office/projects') return false;
  if (path.startsWith('/office/projects/')) {
    const rest = path.slice('/office/projects/'.length);
    const parts = rest.split('/');
    if (parts.length === 2 && ['stages','drawings','tenders','variations','certificates','shop-drawings','site-walk','finishes'].includes(parts[1])) {
      return false;
    }
    return true;
  }
  if (path.startsWith('/office/tenders/')) {
    const rest = path.slice('/office/tenders/'.length);
    if (/^[0-9a-f-]{36}$/.test(rest)) return false;
    if (/^[0-9a-f-]{36}\/levelling$/.test(rest)) return false;
    return true;
  }
  if (path.startsWith('/invite/') || path.startsWith('/tender-sign-in/') || path.startsWith('/preview/')) {
    return !/^[0-9A-Za-z_-]{20,}$/.test(path.split('/')[2] ?? '');
  }
  if (path.startsWith('/work/')) {
    return !/^[a-z0-9][a-z0-9-]{2,79}$/.test(path.slice('/work/'.length));
  }
  return true;
}

await main();
