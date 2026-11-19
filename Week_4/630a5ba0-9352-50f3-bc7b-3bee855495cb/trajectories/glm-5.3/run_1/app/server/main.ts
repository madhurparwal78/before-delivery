import http from 'node:http';
import { Database } from './db.js';
import { loadConfig } from './config.js';
import { applySchema } from './schema.js';
import { runSeed } from './seed.js';
import { KillBillClient } from './killbill.js';
import { Mailer } from './mail.js';
import { OutboxWorker } from './outbox.js';
import { Sweeper } from './sweeps.js';
import { buildApp } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Database(config.databaseUrl);

  // The schema and seed are applied idempotently every time the app serves.
  await applySchema(db);
  await runSeed(db, config);

  const killbill = new KillBillClient(config.killbill, `i${process.pid}`);
  const mailer = new Mailer(config.smtp);
  const outbox = new OutboxWorker(db, killbill, mailer, config);
  const sweeper = new Sweeper(db, config);

  // Health must not depend on Kill Bill or mail: the queue retries those.
  outbox.start(5_000);
  sweeper.start(10_000);

  const app = buildApp({ db, killbill, mailer, outbox, port: config.port });
  const server = http.createServer(app);
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`tidemark daybook serving on 0.0.0.0:${config.port}\n`);
  });

  const shutdown = (): void => {
    server.close();
    outbox.stop();
    sweeper.stop();
    void db.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main().catch((e: unknown) => {
  process.stderr.write(`failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
