import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { BackgroundWork } from './core/background.js';
import type { AppContext } from './core/context.js';
import { loadLibrarySettings } from './core/library.js';
import { ServiceProbes } from './core/probes.js';
import { loadSigningSecret } from './core/secret.js';
import { createPool, waitForDatabase } from './db/pool.js';
import { createSchema } from './db/schema.js';
import { seed } from './db/seed.js';
import { AssetServer } from './http/assets.js';
import { Pipeline } from './http/pipeline.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { holdRoutes } from './routes/holds.js';
import { loanRoutes } from './routes/loans.js';
import { photoRoutes } from './routes/photos.js';
import { sessionRoutes } from './routes/session.js';
import { settlementRoutes } from './routes/settlement.js';
import { Billing } from './services/billing.js';
import { ObjectStore } from './services/objectStore.js';

const NOT_FOUND_BODY = JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } });

function writeJson(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

/** Health answers as soon as the server accepts requests, whatever else is down. */
function isHealthRequest(request: IncomingMessage): boolean {
  return request.method === 'GET' && (request.url ?? '').split('?')[0] === '/api/health';
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const assets = new AssetServer(join(dirname(fileURLToPath(import.meta.url)), '..', 'public'));
  const billing = new Billing(config.killbill);
  const objectStore = new ObjectStore(config.s3);
  const probes = new ServiceProbes(billing, objectStore);

  let pipeline: Pipeline | null = null;

  const server = createServer((request, response) => {
    if (isHealthRequest(request)) {
      writeJson(response, 200, JSON.stringify({ status: 'ok' }));
      return;
    }
    const ready = pipeline;
    if (ready === null) {
      writeJson(response, 404, NOT_FOUND_BODY);
      return;
    }
    void ready.handle(request, response).catch(() => {
      if (response.headersSent) response.end();
      else writeJson(response, 404, NOT_FOUND_BODY);
    });
  });
  server.listen(config.port, '0.0.0.0');

  await waitForDatabase(pool);
  await createSchema(pool);
  await seed(pool);
  const secret = await loadSigningSecret(pool);
  const library = await loadLibrarySettings(pool);

  const app: AppContext = { config, pool, secret, library, billing, objectStore, probes };
  pipeline = new Pipeline({
    pool,
    secret,
    assets,
    routes: [
      ...sessionRoutes(app),
      ...catalogueRoutes(app),
      ...holdRoutes(app),
      ...loanRoutes(app),
      ...photoRoutes(app),
      ...settlementRoutes(app),
    ],
  });

  void objectStore.ensureBucket().catch(() => {
    /* the bucket is created again on the next upload once storage returns */
  });

  new BackgroundWork(app).start();
}

void main();
