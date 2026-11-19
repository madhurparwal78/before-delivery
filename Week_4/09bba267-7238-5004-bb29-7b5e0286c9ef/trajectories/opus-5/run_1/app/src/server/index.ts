import { config } from './config';
import { withTransaction } from './db';
import { createServer } from './http/server';
import { startLiveUpdates } from './live';
import { markSchemaReady } from './ready';
import { SCHEMA_SQL } from './schema';
import { applySeed } from './seed';
import { startSweeper } from './sweeper';

const DATABASE_RETRY_MS = 2_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await withTransaction(async (db) => {
        await db.query(SCHEMA_SQL);
        await applySeed(db);
      });
      return;
    } catch {
      await wait(DATABASE_RETRY_MS);
    }
  }
}

async function main(): Promise<void> {
  const server = createServer();
  server.listen(config.port, '0.0.0.0');
  await prepareDatabase();
  markSchemaReady();
  await startLiveUpdates();
  startSweeper();
}

void main();
