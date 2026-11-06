import { applySchema, pool } from './db/pool';
import { seedIfEmpty } from './db/seed';
import { warnExpiringCredentials } from './domain/credentials';
import { config } from './env';
import { createApp } from './http/app';
import { startBackgroundWork } from './jobs/background';
import { ensureAllAccounts } from './services/killbill';
import { ensureBucket } from './services/storage';
import { serverState } from './state';

const BOOT_RETRY_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await seedIfEmpty(new Date());
      return;
    } catch (error) {
      console.error('waiting for PostgreSQL', error instanceof Error ? error.message : error);
      await sleep(BOOT_RETRY_MS);
    }
  }
}

async function prepareDependencies(): Promise<void> {
  try {
    await ensureBucket();
  } catch (error) {
    console.error('file storage is not ready yet', error instanceof Error ? error.message : error);
  }
  try {
    await ensureAllAccounts(pool);
  } catch (error) {
    console.error('billing is not ready yet', error instanceof Error ? error.message : error);
  }
  try {
    await warnExpiringCredentials(new Date());
  } catch (error) {
    console.error('credential warnings postponed', error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  const app = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Seatweaver listening on ${config.port}`);
  });
  await prepareDatabase();
  serverState.ready = true;
  await prepareDependencies();
  startBackgroundWork();
}

void main();
