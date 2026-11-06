import { pool, ensureSchema, isDbError } from './db.js';

// The app clock: real time, unless the test clock is set. The set instant is
// stored in the database and shared by every instance within a second.
let cachedTestAt: number | null = null;
let cachedAt = 0;

export async function appNow(): Promise<number> {
  if (Date.now() - cachedAt > 1000) {
    try {
      const r = await pool.query<{ at: Date | null }>('SELECT at FROM test_clock WHERE id = 1');
      cachedTestAt = r.rows[0]?.at ? new Date(r.rows[0].at).getTime() : null;
      cachedAt = Date.now();
    } catch (err) {
      if (isDbError(err)) {
        cachedAt = Date.now();
        // fall through to real time; data routes answer 503 anyway
      } else {
        throw err;
      }
    }
  }
  return cachedTestAt ?? Date.now();
}

export async function setTestClock(at: number | null): Promise<void> {
  await ensureSchema();
  await pool.query('UPDATE test_clock SET at = $1 WHERE id = 1', [at === null ? null : new Date(at)]);
  cachedTestAt = at;
  cachedAt = Date.now();
}

export function isoZ(instant: number): string {
  return new Date(instant).toISOString();
}
