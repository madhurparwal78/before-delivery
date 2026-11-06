import { config } from './config.js';
import { applySchema } from './db/pool.js';
import { applySeed } from './db/seed.js';
import { createApp } from './app.js';
import { startSweeper } from './jobs/sweeper.js';
import { ensureBucket } from './services/storage.js';

async function main(): Promise<void> {
  await applySchema();
  await applySeed();

  // A storage outage at boot must not stop the server; the bucket is created on a later pass.
  ensureBucket().catch((error: unknown) => {
    process.stderr.write(`bucket not ready yet: ${String(error)}\n`);
  });

  const app = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`kerf frequencies listening on 0.0.0.0:${config.port}\n`);
  });

  startSweeper();
}

void main().catch((error: unknown) => {
  process.stderr.write(`failed to start: ${String(error)}\n`);
  process.exit(1);
});
