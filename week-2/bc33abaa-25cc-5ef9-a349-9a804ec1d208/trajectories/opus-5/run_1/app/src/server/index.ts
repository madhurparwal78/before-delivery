import { config } from './config';
import { applySchema, pool } from './db/pool';
import { applySeed } from './db/seed';
import { markSchemaReady } from './db/ready';
import { createApp } from './http/app';
import { startScheduler } from './scheduler';
import { ensureCollections } from './services/pocketbase';
import { ensureCatalog } from './services/killbill';

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await applySeed();
      markSchemaReady();
      return;
    } catch (error) {
      process.stderr.write(`waiting for PostgreSQL: ${String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

/** Optional services are retried in the background until they first answer. */
function connectOptionalServices(): void {
  const attempt = async (): Promise<boolean> => {
    const results = await Promise.allSettled([ensureCollections(), ensureCatalog()]);
    return results.every((result) => result.status === 'fulfilled');
  };
  const retry = (): void => {
    void attempt().then((done) => {
      if (!done) setTimeout(retry, 5_000);
    });
  };
  retry();
}

async function main(): Promise<void> {
  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Orrery Studio listening on ${config.port}\n`);
  });
  await waitForDatabase();
  connectOptionalServices();
  const scheduler = startScheduler();
  const shutdown = (): void => {
    clearInterval(scheduler);
    server.close();
    void pool.end().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
