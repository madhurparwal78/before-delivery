import { config } from './config';
import { one, pool, type Queryable } from './db';

let offsetMs = 0;

/** The business clock: real time moved only by the clock route (or CELMATE_START_AT at first start). */
export const now = (): number => Date.now() + offsetMs;
export const instant = (ms: number = now()): string => new Date(ms).toISOString();

export async function startClock(): Promise<void> {
  const start = config.startAt === null ? 0 : config.startAt - Date.now();
  await pool.query('INSERT INTO clock (id, offset_ms) VALUES (1, $1) ON CONFLICT DO NOTHING', [start]);
  await syncClock();
}

/** Reads the stored offset; returns true when another server moved the clock. */
export async function syncClock(q: Queryable = pool): Promise<boolean> {
  const row = await one<{ offset_ms: number }>(q, 'SELECT offset_ms FROM clock WHERE id = 1');
  const changed = row !== undefined && row.offset_ms !== offsetMs;
  if (row) offsetMs = row.offset_ms;
  return changed;
}

export async function moveClock(change: { advanceSeconds: number } | { set: number }): Promise<number> {
  await syncClock();
  const next = 'set' in change ? change.set - Date.now() : offsetMs + change.advanceSeconds * 1000;
  await pool.query('UPDATE clock SET offset_ms = $1 WHERE id = 1', [next]);
  offsetMs = next;
  return now();
}
