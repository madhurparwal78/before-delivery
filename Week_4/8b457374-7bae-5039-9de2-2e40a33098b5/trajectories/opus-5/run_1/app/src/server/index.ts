import { config } from './config.js';
import { applySchema, waitForDatabase } from './data/db.js';
import { seed } from './data/seed.js';
import { startServer } from './http/server.js';
import { buildRouter } from './routes/index.js';
import { startJobs } from './jobs/scheduler.js';
import { ensureBucket } from './services/storage.js';

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();

  try {
    await ensureBucket();
  } catch {
    // Storage is unreachable at boot; the server still starts and reports it down.
  }
  await seed();

  await startServer(buildRouter(), config.port);
  process.stdout.write(`Dotgain listening on 0.0.0.0:${config.port}\n`);
  startJobs();
}

void main();
