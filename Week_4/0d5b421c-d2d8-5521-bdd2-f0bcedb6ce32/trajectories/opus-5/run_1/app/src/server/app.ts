import path from 'node:path';
import express, { type Express } from 'express';
import { errorHandler, jsonBody, originGuard, sendJson } from './http';
import { eventsRouter } from './routes/events';
import { holdsRouter } from './routes/holds';
import { hostRouter } from './routes/host';
import { manageRouter } from './routes/manage';
import { publicRouter } from './routes/public';
import { waitlistRouter } from './routes/waitlist';

const CLIENT_DIR = path.join(__dirname, '..', 'client');

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(
    '/api',
    jsonBody,
    originGuard,
    publicRouter,
    eventsRouter,
    holdsRouter,
    manageRouter,
    waitlistRouter,
    hostRouter,
  );
  app.use('/api', (_req, res) => {
    sendJson(res, 404, {
      error: { code: 'not_found', message: 'We could not find that.' },
    });
  });
  app.use('/api', errorHandler);

  app.use(
    express.static(CLIENT_DIR, {
      index: false,
      dotfiles: 'ignore',
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('*', (req, res) => {
    // Only pages fall back to the app shell: a request for a file the build does not contain,
    // such as a source file or the run manifest, is simply not found.
    const lastSegment = req.path.split('/').pop() ?? '';
    if (lastSegment.includes('.')) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });
  app.use(errorHandler);

  return app;
}
