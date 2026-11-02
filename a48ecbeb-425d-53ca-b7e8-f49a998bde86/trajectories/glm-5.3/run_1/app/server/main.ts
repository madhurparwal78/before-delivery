import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { initSchema } from './db.js';
import { api, refreshServiceStatus } from './api/index.js';
import { startJobs } from './jobs.js';
import { seed, seedAccounts, seedCatalog, seedStockLevels } from './seed.js';
import { openRealtime } from './services/pocketbase.js';
import { broadcastLive } from './api/live.js';
import { databaseName } from './env.js';
import * as pb from './services/pocketbase.js';
import { putObject } from './services/s3.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, '..', 'web');
const publicDir = path.join(here, '..', 'public');

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', (reason as Error)?.message ?? reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.message ?? err);
});

const app = express();
app.disable('x-powered-by');
app.use('/api', api);

// never serve source files, manifests or environment files
const FORBIDDEN = [/^\/server\//, /^\/web\//, /^\/scripts\//, /^\/dist\/server\//, /^\/run\.json$/, /^\/package(-lock)?\.json$/, /^\/tsconfig\.json$/, /^\/\.env/];
app.use((req, res, next) => {
  if (FORBIDDEN.some((re) => re.test(req.path))) {
    res.status(404).send(notFoundPage());
    return;
  }
  next();
});

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

// static assets
app.use('/assets', express.static(path.join(webDir, 'assets'), { fallthrough: false }));
app.use('/public', express.static(publicDir, { fallthrough: false }));

// page routes all render the same shell
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'not_found', message: "We couldn't find that page." });
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(shellHtml());
});

function shellHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ceibo Shop &amp; Cellar</title>
<link rel="stylesheet" href="/public/styles.css">
<link rel="preload" href="/public/fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/public/fonts/atkinson.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/public/fonts/plexmono.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<div id="app"></div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}

function notFoundPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><h1>We couldn't find that page.</h1></body></html>`;
}

async function main(): Promise<void> {
  try {
    await initSchema();
  } catch (e) {
    console.error('[boot] Postgres schema init failed; continuing to serve health:', (e as Error).message);
  }
  const boot = async (): Promise<void> => {
    let ready = true;
    try {
      await seed();
    } catch {
      ready = false;
    }
    try {
      await pb.initCollections();
      await seedAccounts();
      await seedStockLevels();
    } catch {
      // PocketBase down at boot; retried in the background.
    }
    try {
      await seedCatalog();
    } catch {
      // Kill Bill down at boot; retried in the background.
    }
    if (ready) {
      try {
        await putObject('health/health.txt', Buffer.from('ok'), 'text/plain');
      } catch {
        // MinIO down at boot; service status will show it.
      }
    }
  };
  void boot();
  setInterval(() => {
    void boot();
  }, 60_000).unref?.();

  void refreshServiceStatus(true);
  setInterval(() => {
    void refreshServiceStatus();
  }, 5000).unref?.();

  startJobs();

  // PocketBase realtime -> /api/live
  openRealtime((event) => {
    if (event.collection === 'stock_levels') {
      const record = event.record as { scope?: string; flavour?: string; stock_left?: number };
      if (record.scope === databaseName() && typeof record.flavour === 'string' && typeof record.stock_left === 'number') {
        broadcastLive('stock', { flavour: record.flavour, stock_left: record.stock_left });
      }
    } else if (event.collection === 'reviews') {
      const record = event.record as { scope?: string; flavour?: string };
      if (record.scope === databaseName()) {
        broadcastLive('review', { flavour: record.flavour, review: record });
      }
    }
  });

  const port = env.publicPort;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Ceibo Shop & Cellar serving on 0.0.0.0:${port}`);
  });
}

void main();

