import { config } from './config';
import { pool, type Queryable } from './db';

/** Server time: real time plus the offset stored in the database, so every running copy agrees. */
export async function now(client: Queryable = pool): Promise<Date> {
  const result = await client.query<{ offset_ms: string }>('SELECT offset_ms FROM app_clock WHERE id = 1');
  const offset = result.rows[0] ? Number(result.rows[0].offset_ms) : new Date(config.startAt).getTime() - Date.now();
  return new Date(Date.now() + offset);
}

export async function advanceClock(ms: number, client: Queryable = pool): Promise<Date> {
  await client.query('UPDATE app_clock SET offset_ms = offset_ms + $1 WHERE id = 1', [ms]);
  return now(client);
}

export async function resetClock(client: Queryable): Promise<void> {
  const offset = new Date(config.startAt).getTime() - Date.now();
  await client.query('INSERT INTO app_clock (id, offset_ms) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET offset_ms = $1', [offset]);
}

export const addMs = (date: Date, ms: number): Date => new Date(date.getTime() + ms);
