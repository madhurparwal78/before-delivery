import { env } from './env.js';
import { applySchema } from './schema.js';
import { seedOnce } from './seed.js';
import { loadAssets } from './http/assets.js';
import { createHttpServer } from './http/serve.js';
import { startEmailQueue } from './workers/email-queue.js';
import { startBillingPoster } from './workers/billing-poster.js';

async function main(): Promise<void> {
  await loadAssets();
  const server = createHttpServer();
  server.listen(env.port, '0.0.0.0');

  await applySchema();
  await seedOnce();
  startEmailQueue();
  startBillingPoster();
}

void main();
