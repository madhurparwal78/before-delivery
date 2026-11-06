import { createServer } from 'node:http';
import { join } from 'node:path';
import { loadConfig } from './config';
import { createDatabase, waitForDatabase } from './db/pool';
import { applySchemaAndSeed } from './db/seed';
import { BusinessClock } from './domain/clock';
import type { AppServices } from './http/context';
import { createRequestHandler } from './http/handler';
import { startJobs } from './jobs/runner';
import { KillBill } from './services/killbill';
import { Mailer } from './services/mailer';
import { TicketStorage } from './services/storage';

async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  const app: AppServices = {
    config,
    ready: { value: false },
    database,
    clock: new BusinessClock(config.clock.start, config.clock.rate),
    killbill: new KillBill(config),
    storage: new TicketStorage(config),
    mailer: new Mailer(config),
  };

  const handler = createRequestHandler({ app, staticDir: join(__dirname, 'static') });
  const server = createServer(handler);
  server.listen(config.app.port, '0.0.0.0', () => {
    process.stdout.write(`pakka-rail listening on 0.0.0.0:${config.app.port}\n`);
  });

  await waitForDatabase(database);
  await applySchemaAndSeed(database);
  app.ready.value = true;
  startJobs(app);
}

void main().catch((error) => {
  process.stderr.write(`pakka-rail failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
