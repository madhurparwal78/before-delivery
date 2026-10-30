import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import {
  bodyReader,
  errorHandler,
  loadCaller,
  originGuard,
} from './http/middleware.js';
import { notFound } from './lib/errors.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { boxOfficeRouter } from './routes/boxOffice.js';
import { curateRouter } from './routes/curate.js';
import { financeRouter } from './routes/finance.js';
import { groupRouter } from './routes/group.js';
import { publicRouter } from './routes/publicRoutes.js';
import { shopRouter } from './routes/shop.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, '../client');

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(originGuard);
  app.use('/api', bodyReader);
  app.use('/api', loadCaller);

  app.use('/api', publicRouter);
  app.use('/api', authRouter);
  app.use('/api', shopRouter);
  app.use('/api', curateRouter);
  app.use('/api', boxOfficeRouter);
  app.use('/api', groupRouter);
  app.use('/api', financeRouter);
  app.use('/api', adminRouter);

  app.use('/api', (_req, _res, next) => {
    next(notFound());
  });

  app.use(
    express.static(clientRoot, {
      index: false,
      dotfiles: 'deny',
      setHeaders: (res, path) => {
        if (path.includes(`${join('assets')}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  /**
   * Only built browser assets and the API are served: any path naming a file that is not a built
   * asset answers 404, and application routes fall back to the single page.
   */
  app.use((req: Request, res: Response) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const lastSegment = req.path.split('/').pop() ?? '';
    if (lastSegment.includes('.')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const indexFile = join(clientRoot, 'index.html');
    if (!existsSync(indexFile)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.sendFile(indexFile);
  });

  app.use(errorHandler);
  return app;
}
