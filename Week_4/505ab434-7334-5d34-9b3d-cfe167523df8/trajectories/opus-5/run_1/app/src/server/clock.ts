import { config } from './config.js';
import { db, type Queryable } from './db.js';

export async function initClock(): Promise<void> {
  await db.query('insert into app_clock (id, now_at) values (1, $1) on conflict (id) do nothing', [
    new Date(config.appStartAt),
  ]);
}

export async function readClock(source: Queryable = db): Promise<Date> {
  const result = await source.query<{ now_at: Date }>('select now_at from app_clock where id = 1');
  const row = result.rows[0];
  if (!row) throw new Error('App clock is missing');
  return row.now_at;
}

export async function writeClock(source: Queryable, now: Date): Promise<void> {
  await source.query('update app_clock set now_at = $1 where id = 1', [now]);
}
