// The server clock: real time plus an offset stored in the database, so every instance sharing the
// database reads the same clock. All server-side time decisions go through `serverNow`.
import { isoInstant, coopTime, COOP_ZONE } from "../shared/coop-time.js";
import { one, query, type Client } from "./db.js";

const NOW_SQL = "SELECT ((extract(epoch FROM clock_timestamp()) * 1000)::bigint + offset_ms) AS now FROM app_clock WHERE id = 1";

/** Server-clock now, floored to whole seconds (every API instant is whole seconds). */
export async function serverNow(client?: Client): Promise<Date> {
  const row = await one<{ now: number }>(NOW_SQL, [], client);
  const ms = row?.now ?? Date.now();
  return new Date(Math.floor(ms / 1000) * 1000);
}

export async function setServerNow(target: Date): Promise<void> {
  await query("UPDATE app_clock SET offset_ms = $1::bigint - (extract(epoch FROM clock_timestamp()) * 1000)::bigint WHERE id = 1",
    [target.getTime()]);
}

export function clockBody(now: Date): { now: string; now_display: string; zone: string } {
  return { now: isoInstant(now), now_display: coopTime(now), zone: COOP_ZONE };
}
