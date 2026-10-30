import { config } from './config.js';
import { query } from './db.js';

interface ClockRow {
  frozen_at: Date | null;
}

const CACHE_MILLIS = 900;

let cached: { frozenAt: Date | null; readAt: number } | null = null;

/**
 * The app clock: real time, unless the test clock is set, and then that frozen instant.
 * The instant lives in the database so every instance follows it within a second.
 */
export async function now(): Promise<Date> {
  if (!config.testClockEnabled) return new Date();
  if (cached && Date.now() - cached.readAt < CACHE_MILLIS) {
    return cached.frozenAt ? new Date(cached.frozenAt) : new Date();
  }
  const result = await query<ClockRow>('select frozen_at from app_clock where id = true');
  const frozenAt = result.rows[0]?.frozen_at ?? null;
  cached = { frozenAt, readAt: Date.now() };
  return frozenAt ? new Date(frozenAt) : new Date();
}

export async function setTestClock(instant: Date): Promise<void> {
  await query(
    `insert into app_clock (id, frozen_at) values (true, $1)
     on conflict (id) do update set frozen_at = excluded.frozen_at`,
    [instant],
  );
  cached = { frozenAt: instant, readAt: Date.now() };
}

export async function clearTestClock(): Promise<void> {
  await query(
    `insert into app_clock (id, frozen_at) values (true, null)
     on conflict (id) do update set frozen_at = null`,
  );
  cached = { frozenAt: null, readAt: Date.now() };
}
