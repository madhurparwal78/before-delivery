import { applySchema } from './db.js';
import { env } from './env.js';
import { createHttpServer } from './http.js';
import { loadPeople } from './people.js';
import { applySeed, writeSeedObjects } from './seed.js';
import { expireDueShares } from './shares.js';
import { startPresenceSweep } from './socket.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await applySeed();
      await loadPeople();
      return;
    } catch (error) {
      process.stderr.write(`database not ready: ${String(error)}\n`);
      await sleep(2_000);
    }
  }
}

async function main(): Promise<void> {
  const server = createHttpServer();
  server.listen(env.port, '0.0.0.0', () => {
    process.stdout.write(`Quillmere Drafts listening on ${env.port}\n`);
  });
  await prepareDatabase();
  writeSeedObjects();
  startPresenceSweep();
  setInterval(() => void expireDueShares(), 500);
}

void main();
