import { fileURLToPath } from 'node:url';
import path from 'node:path';

import express, { type NextFunction, type Request, type Response } from 'express';

import { ServerClock } from './clock.js';
import { loadConfig } from './config.js';
import { Database, DatabaseUnavailable } from './db/pool.js';
import { applySeed } from './db/seed.js';
import { findUsablePacketByToken } from './domain/packets.js';
import { runSweep } from './domain/sweeps.js';
import { sameOriginOnly, securityHeaders } from './http/boundary.js';
import type { AppContext } from './http/context.js';
import { HttpError } from './http/errors.js';
import { renderPacketNotValidPage, renderPacketPage } from './http/packet-page.js';
import { buildApiRouter } from './http/router.js';
import { apiRoutes } from './http/routes/index.js';
import { BillingMonitor } from './services/billing-monitor.js';
import { BillingUnavailable, KillBillClient } from './services/killbill.js';
import { Mailer } from './services/mailer.js';
import { ObjectStorage, StorageUnavailable } from './services/storage.js';

const SWEEP_INTERVAL_MS = 3000;
const SPA_ROUTES = [
  '/',
  '/board',
  '/hours',
  '/documents',
  '/invoices',
  '/shifts',
  '/review',
  '/members',
  '/usage',
  '/packets',
];

function buildApp(app: AppContext, webRoot: string): express.Express {
  const server = express();
  server.disable('x-powered-by');
  server.set('etag', false);
  server.use(securityHeaders);
  server.use(sameOriginOnly);

  // Health answers even while every dependency is down.
  server.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  server.use('/api', (req, res, next) => {
    void app.db.ensureReady().then((ready) => {
      if (ready) {
        next();
        return;
      }
      res.status(503).json({ error: 'database_unavailable' });
    }, next);
    void req;
  });

  server.use('/api', buildApiRouter(app, apiRoutes));

  server.get('/packet/:token', (req, res, next) => {
    const token = req.params.token;
    void (async () => {
      const packet = await findUsablePacketByToken(app.db, token, app.clock.now());
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (packet === null) {
        res.status(404).end(renderPacketNotValidPage());
        return;
      }
      res.status(200).end(renderPacketPage(packet.snapshot, token));
    })().catch(next);
  });

  server.use(
    express.static(webRoot, {
      index: false,
      dotfiles: 'ignore',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    }),
  );

  // Only the screens in this brief fall back to the application shell.
  server.get(/.*/, (req, res, next) => {
    if (req.method !== 'GET' || !SPA_ROUTES.includes(req.path)) {
      next(new HttpError(404, 'not_found'));
      return;
    }
    res.sendFile(path.join(webRoot, 'index.html'), (error) => {
      if (error) next(error);
    });
  });

  server.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const wantsJson = req.path.startsWith('/api');
    const send = (status: number, body: Record<string, unknown>): void => {
      if (wantsJson) {
        res.status(status).json(body);
      } else {
        res.status(status).type('text/plain').end(String(body['error']));
      }
    };

    if (error instanceof HttpError) {
      send(error.status, error.toBody());
      return;
    }
    if (error instanceof DatabaseUnavailable) {
      send(503, { error: 'database_unavailable' });
      return;
    }
    if (error instanceof StorageUnavailable) {
      send(503, { error: 'storage_unavailable' });
      return;
    }
    if (error instanceof BillingUnavailable) {
      app.billing.markDown();
      send(503, { error: 'billing_unavailable' });
      return;
    }
    process.stderr.write(`unhandled error: ${String(error)}\n`);
    send(500, { error: 'internal_error' });
  });

  return server;
}

function main(): void {
  const config = loadConfig();
  const clock = new ServerClock(config.timeZone, config.fixedNow);
  const killBill = new KillBillClient(config.killBill);

  const context: AppContext = {
    config,
    clock,
    db: new Database(config.databaseUrl, (runner) => applySeed(runner, clock.now())),
    killBill,
    storage: new ObjectStorage(config.storage),
    mailer: new Mailer(config.smtp),
    billing: new BillingMonitor(killBill),
  };

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webRoot = path.resolve(here, '../web');
  const server = buildApp(context, webRoot);

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Passboard listening on ${config.port}\n`);
  });

  // Dependencies unreachable at boot never stop the server; the loop keeps
  // retrying so everything is picked up without a restart.
  const tick = (): void => {
    void runSweep(context).catch((error: unknown) => {
      if (error instanceof DatabaseUnavailable) return;
      process.stderr.write(`sweep failed: ${String(error)}\n`);
    });
  };
  tick();
  setInterval(tick, SWEEP_INTERVAL_MS).unref();
}

main();
