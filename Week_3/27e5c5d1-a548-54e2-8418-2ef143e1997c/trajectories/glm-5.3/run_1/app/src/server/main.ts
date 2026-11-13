import { Pool } from 'pg';
import { buildApp } from './app.js';
import { registerStaticRoutes } from './static.js';
import { migrateAndSeed } from './migrate.js';
import { readConfig } from './config.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKER_ID = process.env.KINFOLD_WORKER_ID === '2' ? 2 : 1;

async function waitForDatabase(pool: Pool): Promise<void> {
  // PostgreSQL is required: retry every second until it answers.
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 1000));
    }
  }
}

function acceptSharedConnections(app: Awaited<ReturnType<typeof buildApp>>['app']): void {
  process.on('message', (message: unknown, socket: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      (message as { type: string }).type === 'connection'
    ) {
      const handle = socket as import('node:net').Socket;
      app.server.emit('connection', handle);
      handle.resume();
    }
  });
}

function main(): Promise<void> {
  const config = readConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
  const clientDir = resolve(process.cwd(), 'public');
  if (!existsSync(clientDir)) {
    console.error('Missing browser assets directory');
    process.exit(1);
  }
  return waitForDatabase(pool)
    .then(() => migrateAndSeed(pool))
    .then(() => buildApp(pool, WORKER_ID as 1 | 2))
    .then(async ({ app, runtime }) => {
      registerStaticRoutes(app, clientDir, WORKER_ID as 1 | 2);
      acceptSharedConnections(app);
      await runtime.start();
      await app.ready();
      // Standalone runs bind their own socket; the two-worker serve passes connections in.
      if (!process.send) {
        await app.listen({ port: config.port, host: '0.0.0.0' });
      }
      console.log(`kinfold worker ${WORKER_ID} serving`);
    })
    .catch((error: unknown) => {
      console.error('start failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}

void main();
