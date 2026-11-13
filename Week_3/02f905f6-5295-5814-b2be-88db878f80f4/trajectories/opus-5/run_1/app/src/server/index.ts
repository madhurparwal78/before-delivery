import path from 'node:path';
import express from 'express';
import { env } from './env';
import { ping } from './db/pool';
import { applySchemaAndSeed } from './db/seed';
import { ApiRouter } from './http/router';
import { allRoutes } from './routes';
import { ensureBucket } from './services/storage';
import { ensureMemberAccounts } from './services/accounts';
import { flushOutbox } from './repo/outbox';
import { tickPickupClock } from './flows/pickupClock';

const CLIENT_DIR = path.resolve(__dirname, '../../client');
const OUTBOX_INTERVAL_MS = 10_000;
const PICKUP_TICK_MS = 5_000;

/** The paths the browser app owns; everything else is not ours to serve. */
const APP_PAGES = [
  /^\/$/,
  /^\/intake$/,
  /^\/pieces$/,
  /^\/pieces\/[^/]+$/,
  /^\/board$/,
  /^\/counter$/,
  /^\/pickup$/,
  /^\/studio$/,
  /^\/rates$/,
  /^\/track\/[^/]+$/,
];

function start(): void {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  const api = new ApiRouter(allRoutes);
  app.all('/api/*', (req, res) => {
    void api.handle(req, res);
  });

  app.use(
    express.static(CLIENT_DIR, {
      index: false,
      dotfiles: 'ignore',
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    }),
  );

  app.get('*', (req, res) => {
    if (APP_PAGES.some((page) => page.test(req.path))) {
      res.sendFile(path.join(CLIENT_DIR, 'index.html'));
      return;
    }
    res.status(404).json({ error: 'not_found', message: 'Not found.' });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Not found.' });
  });

  app.listen(env.port, '0.0.0.0', () => {
    process.stdout.write(`Shelfmark listening on ${env.port}\n`);
  });
}

/** Keeps trying Postgres; health answers `starting` until it is there. */
async function waitForDatabase(): Promise<void> {
  for (;;) {
    if (await ping()) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function boot(): Promise<void> {
  start();
  await waitForDatabase();
  await applySchemaAndSeed();
  await ensureBucket();
  await ensureMemberAccounts().catch(() => undefined);

  setInterval(() => {
    void flushOutbox();
  }, OUTBOX_INTERVAL_MS);
  setInterval(() => {
    void tickPickupClock(new Date());
  }, PICKUP_TICK_MS);
  void flushOutbox();
}

void boot();
