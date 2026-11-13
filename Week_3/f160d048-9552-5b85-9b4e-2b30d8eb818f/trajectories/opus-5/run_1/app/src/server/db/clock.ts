import { db, type Db } from './pool';

/**
 * The server clock is real time plus an offset stored in the database, so every
 * instance sharing that database agrees on now.
 */
async function readOffsetSeconds(runner: Db = db): Promise<number> {
  const row = await runner.one<{ offset_seconds: string }>('SELECT offset_seconds FROM clock_offset WHERE id = true');
  return row ? Number(row.offset_seconds) : 0;
}

export async function advanceOffset(seconds: number): Promise<Date> {
  const row = await db.one<{ offset_seconds: string }>(
    'UPDATE clock_offset SET offset_seconds = offset_seconds + $1 WHERE id = true RETURNING offset_seconds',
    [seconds],
  );
  return new Date(Date.now() + Number(row?.offset_seconds ?? 0) * 1000);
}

export async function serverNow(runner: Db = db): Promise<Date> {
  return new Date(Date.now() + (await readOffsetSeconds(runner)) * 1000);
}
