import { db, type Db } from './db.js';

let offsetSeconds = 0;

export async function loadClock(): Promise<void> {
  const rows = await db.query<{ offset_seconds: string }>('SELECT offset_seconds FROM rs_clock WHERE id = 1');
  offsetSeconds = rows.length > 0 ? Number(rows[0].offset_seconds) : 0;
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetSeconds * 1000);
}

export function clockOffsetSeconds(): number {
  return offsetSeconds;
}

export async function advanceClock(tx: Db, seconds: number): Promise<number> {
  const rows = await tx.query<{ offset_seconds: string }>(
    'UPDATE rs_clock SET offset_seconds = offset_seconds + $1 WHERE id = 1 RETURNING offset_seconds',
    [seconds],
  );
  offsetSeconds = Number(rows[0].offset_seconds);
  return offsetSeconds;
}

export function isoUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
