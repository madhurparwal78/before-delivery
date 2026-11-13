import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { connectWithRetry, pool, query } from './db.ts';
import { applySchemaAndSeed, setUpPocketBase, setUpStorage } from './bootstrap.ts';
import { createHttpServer } from './http/server.ts';
import { attachRealtime, broadcast } from './services/realtime.ts';
import { currentGameweekView } from './game/gameweeks.ts';
import { lockGameweek, flushSnapshots } from './game/lock.ts';
import { flushNotices } from './game/notices.ts';

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');

const everyInterval = (ms: number, work: () => Promise<void>): void => {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void work()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, ms).unref();
};

const advanceGameweeks = async (): Promise<void> => {
  const due = await query<{ number: number }>(
    pool,
    `select number from gameweeks where status = 'open' and deadline is not null and deadline <= now()`,
  );
  for (const gameweek of due) await lockGameweek(gameweek.number);

  const kicking = await query<{ number: number }>(
    pool,
    `update gameweeks set status = 'live'
      where status = 'locked' and first_kickoff is not null and first_kickoff <= now()
      returning number`,
  );
  if (kicking.length > 0) {
    broadcast({ type: 'gameweek', gameweek: await currentGameweekView() });
  }
};

const retryUntilReady = (work: () => Promise<void>, intervalMs: number): void => {
  const attempt = (): void => {
    void work().catch(() => {
      setTimeout(attempt, intervalMs).unref();
    });
  };
  attempt();
};

const main = async (): Promise<void> => {
  try {
    await connectWithRetry(60_000);
  } catch {
    process.exitCode = 1;
    return;
  }
  await applySchemaAndSeed();

  const server = createHttpServer(clientRoot);
  attachRealtime(server);
  server.listen(config.port, '0.0.0.0');

  retryUntilReady(setUpStorage, 5000);
  retryUntilReady(setUpPocketBase, 5000);

  everyInterval(250, advanceGameweeks);
  everyInterval(500, flushNotices);
  everyInterval(5000, flushSnapshots);
};

void main();
