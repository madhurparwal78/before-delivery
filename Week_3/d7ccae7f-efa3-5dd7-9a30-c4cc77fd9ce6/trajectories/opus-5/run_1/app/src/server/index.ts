import { createServer } from 'node:http';
import { config } from './config.js';
import { query } from './db/pool.js';
import { databaseIsReady, markDatabaseReady } from './db/readiness.js';
import { applySchema } from './db/schema.js';
import { applySeed } from './db/seed.js';
import { handleRequest } from './api/router.js';
import { closeAllStreams } from './live/streams.js';
import { onLiveDown, onLiveUp, startLiveProbe, writeLeaderboard } from './live/valkey.js';
import { endIdleRooms, lockExpiredQuestions, refreshPresence } from './rooms/lifecycle.js';

const LOCK_TICK_MS = 400;
const HOUSEKEEPING_TICK_MS = 1_500;
const DATABASE_TICK_MS = 2_000;

const server = createServer((req, res) => {
  void handleRequest(req, res);
});
server.requestTimeout = 0;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 65_000;

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`lastbell listening on ${config.port}\n`);
});

/** Applies the schema and seed, and keeps trying while Postgres is away. */
async function prepareDatabase(): Promise<void> {
  if (databaseIsReady()) return;
  await applySchema();
  await applySeed();
  markDatabaseReady();
}

async function rebuildLeaderboards(): Promise<void> {
  const rooms = await query<{ id: string }>('SELECT id FROM rooms WHERE ended_at IS NULL');
  for (const room of rooms) {
    const standings = await query<{ seat_id: string; score: number }>(
      'SELECT seat_id, score FROM standings WHERE room_id = $1',
      [room.id],
    );
    await writeLeaderboard(
      room.id,
      standings.map((row) => ({ seatId: row.seat_id, score: row.score })),
    );
  }
}

function startTicker(intervalMs: number, work: () => Promise<void>): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void work()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, intervalMs).unref();
}

onLiveDown(closeAllStreams);
onLiveUp(async () => {
  await rebuildLeaderboards().catch(() => undefined);
});

startLiveProbe();
startTicker(DATABASE_TICK_MS, prepareDatabase);
startTicker(LOCK_TICK_MS, async () => {
  if (!databaseIsReady()) return;
  await lockExpiredQuestions();
});
startTicker(HOUSEKEEPING_TICK_MS, async () => {
  if (!databaseIsReady()) return;
  await refreshPresence();
  await endIdleRooms();
});
void prepareDatabase().catch(() => undefined);
