import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { registerAccountRoutes } from './api/accounts';
import { registerBillingRoutes } from './api/billing';
import { registerDossierRoutes } from './api/dossiers';
import { registerOpsRoutes } from './api/ops';
import { registerRevisionRoutes } from './api/revisions';
import { registerVaultRoutes } from './api/vaults';
import { loadConfig } from './config';
import { Database } from './db';
import { ApiError } from './errors';
import { Router } from './http';
import { registerPublicRoutes } from './publicRoutes';
import { applySeedAccounts, applySeedBilling } from './seed';
import { buildServices } from './services';
import { registerStaticRoutes } from './static';
import { Sweeper } from './sweep';

const PUBLIC_DIR = join(__dirname, '..', 'public');

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Database(config.databaseUrl);
  await db.waitUntilReady();
  await db.applySchema();

  const readerAssets = {
    css: await readFile(join(PUBLIC_DIR, 'assets', 'reader.css'), 'utf8'),
    script: await readFile(join(PUBLIC_DIR, 'assets', 'reader.js'), 'utf8'),
  };

  const services = buildServices(config, db, readerAssets);
  await applySeedAccounts(services);
  await services.store.ensureBucket().catch(() => undefined);
  const billingSeeded = await applySeedBilling(services).catch(() => false);

  const sweeper = new Sweeper(services);
  const router = new Router();
  registerAccountRoutes(router, services);
  registerVaultRoutes(router, services);
  registerRevisionRoutes(router, services);
  registerBillingRoutes(router, services);
  registerDossierRoutes(router, services);
  registerOpsRoutes(router, services, sweeper);
  registerPublicRoutes(router, services);
  registerStaticRoutes(router, PUBLIC_DIR);
  router.setFallback(() => {
    throw new ApiError(404, 'not_found', 'Not found.');
  });

  router.listen(config.port, config.publicUrl, (error) => {
    process.stderr.write(`request failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  });
  sweeper.start();
  process.stdout.write(
    `cairn listening on 0.0.0.0:${config.port}${billingSeeded ? '' : ' (billing seeding deferred to the sweep)'}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`cairn failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
