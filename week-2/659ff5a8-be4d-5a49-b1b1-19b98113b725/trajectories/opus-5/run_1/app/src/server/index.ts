import { config } from './config';
import { applySchema, waitForDatabase } from './db/pool';
import { seed } from './db/seed';
import { createApp } from './http/app';
import { startDeliveryRetryLoop } from './services/deliveries';
import { ensureBucket } from './services/storage';

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await seed();

  await ensureBucket().catch((error: unknown) => {
    process.stderr.write(`object storage is not ready yet: ${String(error)}\n`);
  });

  startDeliveryRetryLoop();

  const server = createApp();
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Conecount Paddock listening on 0.0.0.0:${config.port}\n`);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`failed to start: ${String(error)}\n`);
  process.exit(1);
});
