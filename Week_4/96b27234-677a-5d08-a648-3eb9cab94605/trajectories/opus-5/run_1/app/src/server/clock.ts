import { one, query } from './db.js';

export async function worldNow(worldId: string): Promise<Date> {
  const row = await one<{ held_now: Date | null }>('select held_now from worlds where id = $1', [worldId]);
  return row?.held_now ?? new Date();
}

export async function worldExists(worldId: string): Promise<boolean> {
  const row = await one<{ id: string }>('select id from worlds where id = $1', [worldId]);
  return row !== null;
}

export async function setHeldClock(worldId: string, instant: Date | null): Promise<void> {
  await query('update worlds set held_now = $2 where id = $1', [worldId, instant]);
}

export async function allWorldIds(): Promise<string[]> {
  const rows = await query<{ id: string }>('select id from worlds');
  return rows.map((row) => row.id);
}
