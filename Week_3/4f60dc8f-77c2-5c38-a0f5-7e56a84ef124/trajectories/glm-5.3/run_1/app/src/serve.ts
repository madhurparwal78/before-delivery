import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { loadConfig } from './server/config';
import { createPool, applySchema } from './server/db';
import { App } from './server/app';
import { ApiError, errorBody } from './server/errors';
import { publicRoutes } from './server/routes/public';
import { clientRoutes } from './server/routes/client';
import { billingRoutes } from './server/routes/billing';
import { reviewRoutes } from './server/routes/review';
import { studioRoutes } from './server/routes/studio';
import { boundaryMiddleware, errorHandler, readClientSession } from './server/middleware';
import { startOutbox } from './server/outbox';
import { startMeasuring } from './server/measure';
import { seed } from './server/seed';
import { renderPage, renderNotFound } from './pages';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  const app = new App(config, pool);

  const server = express();
  server.disable('x-powered-by');
  server.set('etag', false);

  // Apply the schema idempotently, retried on each request until it succeeds.
  const ensureSchema = async (): Promise<void> => {
    if (!app.schemaReady) {
      try {
        await applySchema(pool);
        app.schemaReady = true;
        await seed(app);
        app.seedsReady = true;
      } catch (error) {
        app.schemaReady = false;
        console.error('setup failed:', error instanceof Error ? error.stack : error);
      }
    }
  };

  server.use(async (_req, _res, next) => {
    await ensureSchema();
    next();
  });

  server.use(boundaryMiddleware(app));

  server.use(async (req, res, next) => {
    // JSON body parsing with the published limit.
    if ((req.headers['content-type'] ?? '').includes('application/json')) {
      let data = '';
      let size = 0;
      let tooLarge = false;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65_536) {
          tooLarge = true;
          req.removeAllListeners('data');
          req.destroy();
        } else if (!tooLarge) {
          data += chunk.toString('utf8');
        }
      });
      req.on('end', () => {
        if (tooLarge) {
          res.status(413).json(errorBody(new ApiError('payload_too_large')));
          return;
        }
        try {
          (req as unknown as { body: unknown }).body = data.length === 0 ? {} : JSON.parse(data);
        } catch {
          (req as unknown as { body: unknown }).body = {};
        }
        next();
      });
      req.on('error', () => {
        if (!res.headersSent) {
          res.status(413).json(errorBody(new ApiError('payload_too_large')));
        }
      });
      return;
    }
    next();
  });

  // API routes
  server.use(publicRoutes(app));
  server.use(clientRoutes(app));
  server.use(billingRoutes(app));
  server.use(reviewRoutes(app));
  server.use(studioRoutes(app));

  // Static assets: fonts, styles, and the client bundle. Never serve source files.
  server.use('/assets', express.static('public/assets', { fallthrough: true, index: false }));
  server.use('/fonts', express.static('public/fonts', { fallthrough: true, index: false }));

  // Pages
  server.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
        return;
      }
      const session = await readClientSession(app, req);
      const result = await renderPage(app, req.path, session);
      if (result.notFound) {
        res.status(404).send(await renderNotFound(app));
        return;
      }
      res.status(200).type('html').send(result.html);
    } catch (error) {
      next(error);
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      if (error.headers) {
        for (const [key, value] of Object.entries(error.headers)) {
          res.setHeader(key, value);
        }
      }
      res.status(error.status).json(errorBody(error));
      return;
    }
    res.status(500).json({ error: 'not_found', message: 'We couldn\'t find that page' });
  });

  // Background work: outbox delivery, measuring queue, delayed publishes, overdue checks.
  startOutbox(app);
  startMeasuring(app);
  startDelayedPublishes(app);
  startOverdueChecks(app);

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Gloamwork Shot Rig listening on port ${config.port}`);
  });
}

function startDelayedPublishes(app: App): void {
  setInterval(async () => {
    try {
      const delayed = await app.pool.query(
        `SELECT id FROM intake_files WHERE measurement = 'delayed'`,
      );
      for (const row of delayed.rows) {
        try {
          await app.queue.publish(row.id);
          await app.pool.query(`UPDATE intake_files SET measurement = 'pending' WHERE id = $1`, [row.id]);
        } catch {
          // still delayed; retried next tick
        }
      }
    } catch {
      // database hiccup
    }
  }, 10_000);
}

function startOverdueChecks(app: App): void {
  setInterval(async () => {
    try {
      const rows = await app.pool.query(
        `SELECT e.* FROM invoices i JOIN engagements e ON e.id = i.engagement_id
         WHERE i.status = 'payment_failed' AND i.overdue_at IS NOT NULL`,
      );
      const { loadEngagementRow } = await import('./server/domain');
      const { refreshOverdue } = await import('./server/invoices');
      for (const row of rows.rows) {
        const engagement = await loadEngagementRow(app.pool, row.id);
        if (engagement) {
          await refreshOverdue(app, engagement);
        }
      }
    } catch {
      // database hiccup
    }
  }, 15_000);
}

void main();
