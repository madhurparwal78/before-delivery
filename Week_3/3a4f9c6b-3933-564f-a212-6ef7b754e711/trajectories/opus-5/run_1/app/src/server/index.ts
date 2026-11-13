import { config } from './config.js';
import { waitForDatabase, withBootLock } from './db.js';
import { startServer } from './http/server.js';
import { loadAssets } from './http/static.js';
import { startExpirySweeper } from './promotions.js';
import { purgeExpiredKeys } from './request-keys.js';
import { applySchema } from './schema.js';
import { applySeed } from './seed.js';
import { startDeliveryWorker } from './services/queues.js';

let ready = false;

async function main(): Promise<void> {
  await loadAssets();
  // Serving starts at once, so health answers `starting` until Postgres is reachable.
  startServer(config.port, () => ready);

  await waitForDatabase();
  await withBootLock(async () => {
    await applySchema();
    await applySeed();
  });
  ready = true;

  startDeliveryWorker();
  startExpirySweeper();
  setInterval(() => void purgeExpiredKeys().catch(() => undefined), 60_000).unref();

  process.stdout.write(`Keelson listening on 0.0.0.0:${config.port}\n`);
}

void main();
