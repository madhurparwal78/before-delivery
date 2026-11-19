import { config } from './config';
import { pool } from './db';

let offsetMs = 0;

/** The server's now: real time, shifted by the controlled-clock offset when one is set. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export async function setServerNow(instant: Date): Promise<void> {
  offsetMs = instant.getTime() - Date.now();
  await pool.query('update app_clock set offset_ms = $1, updated_at = now() where id = 1', [
    offsetMs,
  ]);
}

export async function loadClockOffset(): Promise<void> {
  const result = await pool.query<{ offset_ms: string }>(
    'select offset_ms from app_clock where id = 1',
  );
  const row = result.rows[0];
  if (row) offsetMs = Number(row.offset_ms);
}

export function startClockSync(): NodeJS.Timeout | null {
  if (!config.clockControl) return null;
  return setInterval(() => {
    void loadClockOffset().catch(() => undefined);
  }, 1000);
}
