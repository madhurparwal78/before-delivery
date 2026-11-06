import { query } from './db/pool.js';

const CACHE_MS = 400;

let cachedOffsetMs = 0;
let cachedAt = 0;

/** The server clock is real time plus the offset stored in the database. */
export async function serverNow(): Promise<Date> {
  const realNow = Date.now();
  if (realNow - cachedAt > CACHE_MS) {
    const result = await query<{ offset_ms: string }>('select offset_ms from clock_offset limit 1');
    cachedOffsetMs = result.rows.length > 0 ? Number(result.rows[0]?.offset_ms) : 0;
    cachedAt = realNow;
  }
  return new Date(realNow + cachedOffsetMs);
}

export async function setServerNow(instant: Date): Promise<Date> {
  const offsetMs = instant.getTime() - Date.now();
  await query(
    `insert into clock_offset (only_row, offset_ms) values (true, $1)
     on conflict (only_row) do update set offset_ms = excluded.offset_ms`,
    [offsetMs],
  );
  cachedOffsetMs = offsetMs;
  cachedAt = Date.now();
  return serverNow();
}
