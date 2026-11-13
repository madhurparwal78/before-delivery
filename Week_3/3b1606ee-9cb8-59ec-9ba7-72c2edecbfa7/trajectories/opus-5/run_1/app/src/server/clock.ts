import { pool } from './db.js';

let offsetMs = 0;

export async function loadClockOffset(): Promise<void> {
  const result = await pool.query<{ offset_ms: string }>(
    'select offset_ms from clock_offset where id = 1',
  );
  offsetMs = Number(result.rows[0]?.offset_ms ?? 0);
}

export async function setClockOffset(value: number): Promise<void> {
  offsetMs = value;
  await pool.query(
    'insert into clock_offset (id, offset_ms) values (1, $1) on conflict (id) do update set offset_ms = $1',
    [value],
  );
}

export function clockOffset(): number {
  return offsetMs;
}

/** Server now: the real clock plus the grading offset. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
