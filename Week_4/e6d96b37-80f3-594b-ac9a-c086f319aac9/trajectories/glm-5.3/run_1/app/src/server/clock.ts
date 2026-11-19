import { pool } from "./db.js";

export const DEFAULT_NAMESPACE = "hollowmint";

/** Returns the namespace-clock UTC timestamp for the given namespace. */
export async function now(ns: string): Promise<Date> {
  const real = new Date();
  if (ns === DEFAULT_NAMESPACE) return real;
  const offset = await offsetSeconds(ns);
  return new Date(real.getTime() + offset * 1000);
}

export async function offsetSeconds(ns: string): Promise<number> {
  const res = await pool.query<{ offset_seconds: number }>(
    "SELECT offset_seconds FROM namespace_clocks WHERE namespace = $1",
    [ns],
  );
  const row = res.rows[0];
  if (row === undefined) return 0;
  const delta = (Date.parse(rowIso(row)) - Date.parse(defaultClockIso())) / 1000;
  return Math.round(delta);
}

function rowIso(row: { offset_seconds: number }): string {
  return defaultClockIso(row.offset_seconds);
}

function defaultClockIso(offsetSeconds = 0): string {
  const base = process.env.FLAN_GRADE_CLOCK_ISO || "2026-01-01T12:00:00Z";
  return new Date(Date.parse(base) + offsetSeconds * 1000).toISOString();
}

export function gradeClockBaseIso(): string {
  return process.env.FLAN_GRADE_CLOCK_ISO || "2026-01-01T12:00:00Z";
}

export async function advance(ns: string, seconds: number): Promise<string> {
  const current = await offsetSeconds(ns);
  const next = current + seconds;
  await pool.query(
    "INSERT INTO namespace_clocks (namespace, offset_seconds) VALUES ($1, $2) ON CONFLICT (namespace) DO UPDATE SET offset_seconds = $2",
    [ns, next],
  );
  const iso = new Date(Date.parse(gradeClockBaseIso()) + next * 1000).toISOString();
  return iso;
}

export async function clockIso(ns: string): Promise<string> {
  return (await now(ns)).toISOString();
}

/** Today's UTC date (YYYY-MM-DD) on the namespace clock. */
export async function today(ns: string): Promise<string> {
  return (await now(ns)).toISOString().slice(0, 10);
}
