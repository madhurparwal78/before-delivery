import { config } from './config';
import { pool } from './db';

/**
 * The one business clock. It starts at PLAINWORK_START_AT, runs in real time,
 * and moves only through the grading clock route. Its offset lives in PostgreSQL.
 */
let offsetMs = 0;

export async function initClock(): Promise<void> {
  offsetMs = Date.parse(config.startAt) - Date.now();
  await pool.query(
    `INSERT INTO business_clock (id, offset_ms) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET offset_ms = EXCLUDED.offset_ms`,
    [offsetMs],
  );
}

export function businessNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function businessNowIso(): string {
  return businessNow().toISOString();
}

export async function setBusinessNow(instant: Date): Promise<void> {
  offsetMs = instant.getTime() - Date.now();
  await pool.query('UPDATE business_clock SET offset_ms = $1 WHERE id = 1', [offsetMs]);
}

