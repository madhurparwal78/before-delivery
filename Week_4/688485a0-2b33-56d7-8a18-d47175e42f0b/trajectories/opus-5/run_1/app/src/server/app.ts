import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import express, { Express } from 'express';
import { notFound } from '../shared/errors';
import { boundary, errorHandler, sendError } from './httpUtil';
import { authRoutes, meRoute } from './routes/auth';
import { collectionRoutes } from './routes/collections';
import { fileRoutes } from './routes/files';
import { gradingRoutes } from './routes/grading';
import { indexRoutes } from './routes/indexes';
import { invitationRoutes, projectRoutes } from './routes/projects';
import { publicRoutes } from './routes/publicRoutes';
import { queryRoutes } from './routes/querying';
import { streamRoutes } from './routes/stream';

const WEB_ROOT = join(__dirname, '..', 'web');

const APP_ROUTES = [
  /^\/$/,
  /^\/signup$/,
  /^\/confirm$/,
  /^\/signin$/,
  /^\/projects$/,
  /^\/invites$/,
  /^\/p\/[^/]+$/,
  /^\/p\/[^/]+\/members$/,
  /^\/p\/[^/]+\/c\/[^/]+$/,
  /^\/p\/[^/]+\/c\/[^/]+\/d\/[^/]+$/,
  /^\/p\/[^/]+\/c\/[^/]+\/(queries|pipeline|indexes|schema|rules)$/,
];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

/** Only the built browser assets and the API are served. */
function serveAsset(path: string): { body: Buffer; type: string } | null {
  const relative = normalize(path).replace(/^(\.\.[/\\])+/, '').replace(/^\//, '');
  if (!relative.startsWith('assets/') && relative !== 'favicon.ico') return null;
  const file = join(WEB_ROOT, relative);
  if (!file.startsWith(WEB_ROOT) || !existsSync(file)) return null;
  return { body: readFileSync(file), type: CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' };
}

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use('/api', boundary);
  app.use('/api', publicRoutes);
  app.use('/api', gradingRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api', meRoute);
  app.use('/api', projectRoutes);
  app.use('/api', invitationRoutes);
  app.use('/api', collectionRoutes);
  app.use('/api', queryRoutes);
  app.use('/api', indexRoutes);
  app.use('/api', fileRoutes);
  app.use('/api', streamRoutes);
  app.use('/api', (_req, res) => sendError(res, notFound()));
  app.use('/api', errorHandler);

  app.get('*', (req, res) => {
    const asset = serveAsset(req.path);
    if (asset) {
      res.setHeader('Content-Type', asset.type);
      res.status(200).end(asset.body);
      return;
    }
    const indexFile = join(WEB_ROOT, 'index.html');
    if (!existsSync(indexFile)) {
      res.status(404).type('text/plain').end('Not found');
      return;
    }
    const known = APP_ROUTES.some((pattern) => pattern.test(req.path));
    res.status(known ? 200 : 404).type('text/html').end(readFileSync(indexFile));
  });

  app.use((_req, res) => {
    res.status(404).type('text/plain').end('Not found');
  });

  return app;
}
