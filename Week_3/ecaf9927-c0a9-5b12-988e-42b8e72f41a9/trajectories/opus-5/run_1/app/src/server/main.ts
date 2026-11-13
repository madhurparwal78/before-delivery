import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';
import { applySchema, pool } from './db.js';
import { clearInterruptedSaves } from './domain/partSave.js';
import { createHandler } from './http.js';
import { markReady } from './readiness.js';
import { assemblyRoutes } from './routes/assemblies.js';
import { partRoutes } from './routes/parts.js';
import { sessionRoutes } from './routes/session.js';
import { sketchRoutes } from './routes/sketches.js';
import { ensureSeed, writeMissingSeedBodies } from './seed.js';

const routes = [...sessionRoutes, ...partRoutes, ...sketchRoutes, ...assemblyRoutes];
const appRoot = resolve(dirname(__filename), '..');

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
}

async function start(): Promise<void> {
  const server = createServer(createHandler(routes, appRoot));
  server.listen(config.port, '0.0.0.0');

  await waitForDatabase();
  await applySchema();
  await ensureSeed();
  await clearInterruptedSaves();
  await writeMissingSeedBodies();
  markReady();
}

void start();
