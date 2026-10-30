import { fileURLToPath } from 'node:url';
import express from 'express';
import { notFound } from '../domain/errors.js';
import { createApiRouter } from './api.js';
import { createPageRouter, pageErrors } from './pages.js';
import { configureViews } from './views.js';

const ASSETS_DIR = fileURLToPath(new URL('../../public/assets', import.meta.url));

export function createApp({ assetVersion }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');
  configureViews(app, assetVersion);

  app.use('/assets', express.static(ASSETS_DIR, { index: false, maxAge: '1h' }));
  app.use('/api', createApiRouter());
  app.use(createPageRouter());

  app.use((req, res, next) => next(notFound()));
  app.use(pageErrors);

  return app;
}
