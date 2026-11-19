import { DEFAULT_WORLD, query, queryOne } from './db.js';

interface WorldRow {
  id: string;
  clock_now: Date | null;
}

/** Every time decision reads the world's clock: a held instant, or real time. */
export async function worldNow(worldId: string): Promise<Date> {
  const row = await queryOne<WorldRow>('SELECT id, clock_now FROM worlds WHERE id = $1', [worldId]);
  return row?.clock_now ?? new Date();
}

export async function setWorldClock(worldId: string, now: Date | null): Promise<Date> {
  await query('UPDATE worlds SET clock_now = $2 WHERE id = $1', [worldId, now]);
  return now ?? new Date();
}

export async function createWorld(id: string, now: Date | null): Promise<void> {
  await query('INSERT INTO worlds (id, clock_now) VALUES ($1, $2)', [id, now]);
}

export async function worldExists(worldId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>('SELECT id FROM worlds WHERE id = $1', [worldId]);
  return row !== null;
}

export async function realTimeWorlds(): Promise<string[]> {
  const rows = await query<{ id: string }>('SELECT id FROM worlds WHERE clock_now IS NULL');
  return rows.map((row) => row.id);
}

export { DEFAULT_WORLD };
