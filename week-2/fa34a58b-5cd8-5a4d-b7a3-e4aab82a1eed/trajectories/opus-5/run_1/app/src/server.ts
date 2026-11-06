import { createServer } from 'node:http';
import { config } from './config';
import { applySchema, pool } from './db';
import { startEngine } from './engine';
import { createRouter } from './http/router';
import { seedIfEmpty } from './seed';
import { attachSocket, publishStatus } from './services/broadcast';
import { onServiceHealthChange, startHealthChecks } from './services/health';
import { startOutbox } from './services/outbox';
import { ensureBucket } from './services/storage';

const DATABASE_RETRY_MS = 2000;

let ready = false;

const server = createServer((request, response) => {
  void createRouter({ ready: () => ready })(request, response);
});

attachSocket(server);

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Nightplan listening on 0.0.0.0:${config.port}\n`);
});

async function connectAndPrepare(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      await applySchema();
      await seedIfEmpty();
      return;
    } catch (error) {
      process.stderr.write(`PostgreSQL not ready: ${String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, DATABASE_RETRY_MS));
    }
  }
}

async function main(): Promise<void> {
  await connectAndPrepare();
  ready = true;

  await startHealthChecks();
  onServiceHealthChange(() => {
    void publishStatus();
  });

  try {
    await ensureBucket();
  } catch (error) {
    process.stderr.write(`Object storage not ready at start: ${String(error)}\n`);
  }

  await startEngine();
  startOutbox();
}

void main();
