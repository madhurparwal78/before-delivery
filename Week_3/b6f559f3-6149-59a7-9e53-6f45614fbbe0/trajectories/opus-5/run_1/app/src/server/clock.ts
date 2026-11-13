import { config } from './config';
import { query, queryOne } from './db';

interface SettingRow {
  value: string;
}

/** The clock offset lives in the database so every running copy agrees. */
export async function loadClock(): Promise<void> {
  const row = await queryOne<SettingRow>('SELECT value FROM settings WHERE key = $1', [
    'clock_offset_ms',
  ]);
  if (row) return;
  const startOffset = new Date(config.startAt).getTime() - Date.now();
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ['clock_offset_ms', String(startOffset)],
  );
}

async function offsetMs(): Promise<number> {
  const row = await queryOne<SettingRow>('SELECT value FROM settings WHERE key = $1', [
    'clock_offset_ms',
  ]);
  if (row) return Number(row.value);
  await loadClock();
  const again = await queryOne<SettingRow>('SELECT value FROM settings WHERE key = $1', [
    'clock_offset_ms',
  ]);
  return again ? Number(again.value) : 0;
}

export async function serverNow(): Promise<Date> {
  const offset = await offsetMs();
  return new Date(Date.now() + offset);
}

export async function advanceClock(advanceMs: number): Promise<Date> {
  const offset = await offsetMs();
  const next = offset + advanceMs;
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ['clock_offset_ms', String(next)],
  );
  return new Date(Date.now() + next);
}

export async function resetClock(): Promise<void> {
  const startOffset = new Date(config.startAt).getTime() - Date.now();
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ['clock_offset_ms', String(startOffset)],
  );
}
