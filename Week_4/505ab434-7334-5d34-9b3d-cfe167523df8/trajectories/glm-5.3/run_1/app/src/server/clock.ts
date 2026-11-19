import { query } from './db';
import type { Config } from './config';

const CLOCK_KEY = 'app_clock';

export async function readClock(cfg: Config): Promise<Date> {
  const rows = await query<{ value: string }>('SELECT value FROM app_meta WHERE key = $1', [CLOCK_KEY]);
  if (rows.length === 0) {
    const start = new Date(cfg.appStartAt);
    await query('INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      CLOCK_KEY,
      start.toISOString(),
    ]);
    return start;
  }
  return new Date(rows[0].value);
}

export async function writeClock(value: Date): Promise<void> {
  await query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2::text) ON CONFLICT (key) DO UPDATE SET value = $2::text`,
    [CLOCK_KEY, value.toISOString()],
  );
}

export async function clockAtBoot(cfg: Config): Promise<Date> {
  const rows = await query<{ value: string }>('SELECT value FROM app_meta WHERE key = $1', [CLOCK_KEY]);
  if (rows.length === 0) {
    await query('INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      CLOCK_KEY,
      new Date(cfg.appStartAt).toISOString(),
    ]);
    const again = await query<{ value: string }>('SELECT value FROM app_meta WHERE key = $1', [CLOCK_KEY]);
    return new Date(again[0].value);
  }
  return new Date(rows[0].value);
}
