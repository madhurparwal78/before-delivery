import http from 'node:http';
import { config } from './config.js';
import { applySchema, applySeed } from './db/migrate.js';
import { testDatabase, withClient } from './platform/db.js';
import { dispatch } from './http/dispatch.js';
import { handleConsole } from './http/console.js';
import { handlePublic } from './http/public.js';
import { handleCandidate } from './http/candidate.js';
import { startScheduler, ensureSamplesUploaded } from './platform/scheduler.js';
import { probeStorage } from './platform/storage.js';
import { probeMail } from './platform/mail.js';

let schemaReady = false;

async function start(): Promise<void> {
  // Probe services before serving, so /api/ready reflects reality.
  await probeStorage();
  await probeMail();

  // Apply schema and seed data, retrying until the database is reachable.
  while (!schemaReady) {
    try {
      const dbUp = await testDatabase();
      if (!dbUp) throw new Error('database unreachable');
      await applySchema();
      await applySeed();
      schemaReady = true;
    } catch (e) {
      console.error(`waiting for database: ${(e as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, config.dbRetryMs));
    }
  }

  await ensureSamplesUploaded();
  startScheduler();

  const server = http.createServer((req, res) => {
    void dispatch(req, res, {
      public: handlePublic,
      console: handleConsole,
      candidate: handleCandidate,
    });
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Aldermoor Open Record listening on 0.0.0.0:${config.port}`);
  });
}

void start();
