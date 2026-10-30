import { config } from './config.js';
import { applySchema } from './db/schema.js';
import { seedIfEmpty } from './db/seed.js';
import { startHttpServer } from './http/server.js';
import { startSweeps } from './services/sweeps.js';
import './routes/index.js';

async function main(): Promise<void> {
  await applySchema();
  await seedIfEmpty();
  startHttpServer(config.port);
  startSweeps();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
