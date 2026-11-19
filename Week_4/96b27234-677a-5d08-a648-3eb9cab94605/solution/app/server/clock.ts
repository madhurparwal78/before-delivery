import { one, query, type Db } from "./db.js";

/** The world's clock: a held instant while one is set, otherwise real time. */
export async function worldNow(worldId: string, db?: Db): Promise<Date> {
  const row = await one<{ now: Date }>("SELECT world_now($1) AS now", [worldId], db);
  return row?.now ?? new Date();
}

export async function setWorldClock(worldId: string, now: Date | null): Promise<void> {
  await query("UPDATE worlds SET clock_now = $2 WHERE id = $1", [worldId, now]);
}
