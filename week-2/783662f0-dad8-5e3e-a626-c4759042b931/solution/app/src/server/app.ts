import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { databaseReady } from './db/pool.js';
import { buildError, fail, sendError } from './errors.js';
import { boundary, isNeverServed } from './http/boundary.js';
import { characterRoutes } from './routes/characters.js';
import { coinRoutes } from './routes/coins.js';
import { eventRoutes } from './routes/events.js';
import { partyRoutes } from './routes/parties.js';
import { serverRoutes } from './routes/servers.js';
import { sessionRoutes } from './routes/session.js';
import { tableRoutes } from './routes/tables.js';
import { tradeRoutes } from './routes/trades.js';
import { worldRoutes } from './routes/world.js';

const WEB_ROOT = resolve('dist/web');

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(boundary);

  /* A path holding a NUL byte cannot name any record (Postgres text refuses it): not found. */
  app.use('/api', (req, _res, next: NextFunction) => {
    if (/%00/i.test(req.originalUrl.split('?')[0] ?? '') || req.path.includes('\u0000')) {
      next(fail('not_found'));
      return;
    }
    next();
  });

  /* Health answers as soon as the app is listening, whatever is unreachable. */
  app.use('/api', sessionRoutes);

  app.use('/api', (req, _res, next: NextFunction) => {
    if (!databaseReady() && req.path !== '/health') {
      next(fail('database_unavailable'));
      return;
    }
    next();
  });

  app.use('/api', serverRoutes);
  app.use('/api', characterRoutes);
  app.use('/api', worldRoutes);
  app.use('/api', partyRoutes);
  app.use('/api', tableRoutes);
  app.use('/api', coinRoutes);
  app.use('/api', tradeRoutes);
  app.use('/api', eventRoutes);

  app.use('/api', (_req, _res, next: NextFunction) => {
    next(fail('not_found'));
  });

  app.use(serveStatic);

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    sendError(res, error);
  });

  return app;
}

/**
 * Static files, then the single-page document for every app route. Source
 * files, manifests, credentials and dependencies render the not-found page.
 */
function serveStatic(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next(fail('not_found'));
    return;
  }

  const pathname = decodeURIComponent(req.path);
  if (isNeverServed(pathname)) {
    sendDocument(res, 404);
    return;
  }

  const target = normalize(join(WEB_ROOT, pathname));
  if (target.startsWith(WEB_ROOT) && pathname !== '/' && existsSync(target)) {
    const stats = statSync(target);
    if (stats.isFile()) {
      const type = MIME[extname(target).toLowerCase()];
      if (type !== undefined) res.setHeader('Content-Type', type);
      res.setHeader(
        'Cache-Control',
        pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
      res.status(200);
      createReadStream(target).pipe(res);
      return;
    }
  }

  sendDocument(res, 200);
}

function sendDocument(res: Response, status: number): void {
  const document = join(WEB_ROOT, 'index.html');
  if (!existsSync(document)) {
    const built = buildError(fail('not_found'));
    res.status(status).type('application/json; charset=utf-8').send(JSON.stringify(built.body));
    return;
  }
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  createReadStream(document).pipe(res);
}
