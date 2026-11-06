import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nosniff, originGuard, sendFailure } from './context.js';
import { failures } from './errors.js';
import { billingRoutes } from './routes/billing.js';
import { bookingRoutes } from './routes/bookings.js';
import { coreRoutes } from './routes/core.js';
import { documentRoutes } from './routes/documents.js';
import { loomRoutes } from './routes/loom.js';
import { rateRoutes } from './routes/rates.js';
import { reportRoutes } from './routes/reports.js';
import { seriesRoutes } from './routes/series.js';

/** The browser app owns these paths; everything else is a 404. */
const APP_PATHS = new Set([
  '/',
  '/signin',
  '/loom',
  '/bookings',
  '/papers',
  '/billing',
  '/members',
  '/rates',
  '/reports',
]);

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.use(nosniff);

  const api = express.Router();
  api.use(originGuard);
  api.use(coreRoutes);
  api.use(loomRoutes);
  api.use(seriesRoutes);
  api.use(bookingRoutes);
  api.use(documentRoutes);
  api.use(billingRoutes);
  api.use(rateRoutes);
  api.use(reportRoutes);
  api.use((_req, res) => sendFailure(res, failures.notFound()));
  app.use('/api', api);

  const here = dirname(fileURLToPath(import.meta.url));
  const webRoot = join(here, '..', '..', 'web');
  const indexFile = join(webRoot, 'index.html');

  app.use(
    '/assets',
    express.static(join(webRoot, 'assets'), {
      index: false,
      fallthrough: true,
      maxAge: '1h',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  app.get('/{*path}', (req, res) => {
    if (APP_PATHS.has(req.path) && existsSync(indexFile)) {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(indexFile);
      return;
    }
    sendFailure(res, failures.notFound());
  });

  app.use((_req, res) => sendFailure(res, failures.notFound()));
  return app;
}
