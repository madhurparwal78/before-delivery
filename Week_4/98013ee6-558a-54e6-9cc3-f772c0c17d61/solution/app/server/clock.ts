import { config } from "./config.js";
import { one, pool } from "./db.js";

let offsetMs = 0;

/** The business clock: real time plus the offset kept in Postgres. Nothing else supplies "now". */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export async function loadClock(): Promise<{ startedAt: Date }> {
  const row = await one<{ offset_ms: number; started_at: Date }>(pool, "SELECT offset_ms, started_at FROM clock WHERE id = 1");
  if (!row) throw new Error("the business clock is not initialised");
  offsetMs = Number(row.offset_ms);
  return { startedAt: row.started_at };
}

export async function initClock(): Promise<void> {
  const real = Date.now();
  const start = config.startAt ? config.startAt.getTime() : real;
  await pool.query(
    "INSERT INTO clock (id, offset_ms, started_at) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING",
    [start - real, new Date(start)],
  );
  await loadClock();
}

export async function moveClock(instant: Date): Promise<void> {
  offsetMs = instant.getTime() - Date.now();
  await pool.query("UPDATE clock SET offset_ms = $1 WHERE id = 1", [offsetMs]);
}

export async function clockStart(): Promise<Date> {
  return (await loadClock()).startedAt;
}

export const iso = (moment: Date): string => moment.toISOString();
