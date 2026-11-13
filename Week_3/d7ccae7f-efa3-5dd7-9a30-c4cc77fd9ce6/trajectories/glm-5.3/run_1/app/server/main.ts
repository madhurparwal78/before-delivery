import pg from 'pg';
import { config } from './config.ts';
import { applySchema, applySeed } from './seed.ts';
import { buildApp } from './app.ts';
import { connectLive, isLiveUp, writeLeaderboard } from './live.ts';
import { maybeAutoLock, maybeIdleEnd, loadRoomById } from './roomsService.ts';
import { loadSeats } from './db.ts';
import { rankSeats } from './roomEngine.ts';

import { appSchema } from './seed.ts';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 10_000,
});

// every pooled connection resolves unqualified table names in the app schema
if (appSchema() !== 'public') {
  pool.on('connect', (client) => {
    void client.query(`set search_path to ${appSchema()}, public`).catch(() => undefined);
  });
}

let readyPromise: Promise<void> | null = null;

async function prepareDatabase(): Promise<void> {
  await applySchema(pool);
  await applySeed(pool);
}

function ensureDb(): Promise<void> {
  if (!readyPromise) {
    readyPromise = prepareDatabase().catch((err) => {
      console.error('database setup failed', err);
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

// A pool that answers 503 database_unavailable until Postgres is reachable, with no restart.
const guardedPool: pg.Pool = {
  query: (sql: Parameters<typeof pool.query>[0], values?: Parameters<typeof pool.query>[1]) =>
    ensureDb().then(() => pool.query(sql, values as never)),
  connect: () => ensureDb().then(() => pool.connect()),
  end: () => pool.end(),
} as unknown as pg.Pool;

const app = buildApp(guardedPool);

app.listen(config.appPublicPort, '0.0.0.0', () => {
  console.log(`lastbell listening on 0.0.0.0:${config.appPublicPort}`);
});

async function liveLoop(): Promise<void> {
  await connectLive();
  setTimeout(liveLoop, 5000).unref();
}
liveLoop();

async function sweep(): Promise<void> {
  try {
    await ensureDb();
    const rooms = await pool.query(
      'select id, state, deadline_at, ended_reason, empty_since from rooms where ended_reason is null',
    );
    const now = Date.now();
    for (const row of rooms.rows as Record<string, unknown>[]) {
      const roomId = String(row.id);
      if (row.state === 'question_open' && row.deadline_at !== null && now >= Number(row.deadline_at)) {
        await maybeAutoLock(guardedPool, roomId);
      }
      if (row.empty_since !== null && now - Number(row.empty_since) >= config.roomIdleSeconds * 1000) {
        await maybeIdleEnd(guardedPool, roomId, config.roomIdleSeconds);
      }
    }
  } catch {
    /* retried next sweep */
  }
  setTimeout(sweep, 1000).unref();
}
sweep();

let wasUp = false;
async function reconcileLoop(): Promise<void> {
  try {
    const up = isLiveUp();
    if (up && !wasUp) {
      await ensureDb();
      const rooms = await pool.query(
        'select distinct room_id from standings join rooms on rooms.id = standings.room_id where rooms.ended_reason is null',
      );
      for (const row of rooms.rows as Record<string, unknown>[]) {
        const roomId = String(row.room_id);
        const room = await loadRoomById(guardedPool, roomId);
        const seats = await loadSeats(pool, roomId);
        await writeLeaderboard(roomId, rankSeats(seats), true);
        void room;
      }
    }
    wasUp = up;
  } catch {
    /* retried next tick */
  }
  setTimeout(reconcileLoop, 2000).unref();
}
reconcileLoop();

process.on('unhandledRejection', (err) => {
  console.error('unhandled rejection', err);
});
