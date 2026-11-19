import { one, pool, type Db } from './db';

export const DEFAULT_WORLD = 'wld_default';

/** The only clock: a world's held time, or real time. */
export async function worldNow(worldId: string, db: Db = pool): Promise<number> {
  const world = await one<{ clock_ms: number | null }>(db, 'SELECT clock_ms FROM worlds WHERE id = $1', [worldId]);
  return world?.clock_ms ?? Date.now();
}
