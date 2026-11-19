import { createApp } from './app';
import { loadClockOffset, startClockSync } from './clock';
import { config } from './config';
import { migrateAndSeed, waitForPostgres } from './db';
import { probeKillBill } from './services/killbill';
import { connectValkey, probeValkey } from './services/valkey';
import { startWorkers } from './workers';

async function main(): Promise<void> {
  try {
    await waitForPostgres();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  await migrateAndSeed();
  await loadClockOffset();
  startClockSync();

  connectValkey();
  // A short wait for the first probes, so the first request already knows where it stands.
  await Promise.race([
    Promise.allSettled([probeValkey(), probeKillBill()]),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  startWorkers();

  const app = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Saffron & Slate Tables listening on port ${config.port}`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason);
});

void main();
