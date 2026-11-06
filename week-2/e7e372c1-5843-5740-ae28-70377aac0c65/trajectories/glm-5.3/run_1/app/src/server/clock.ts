// The market clock. Every time rule in the product reads now() from here.
// Real time by default; a rehearsal clock runs forward from the instant an
// operator sets. The setting lives in Postgres so it holds across restarts
// and is shared by every app copy using the database.

import { pool } from "./db.js";
import { parseIsoInstant } from "./nytime.js";

interface ClockRow {
  id: number;
  rehearsal_base_ms: number | null;
  rehearsal_set_real_ms: number | null;
}

export async function ensureClockRow(): Promise<void> {
  await pool.query(
    `INSERT INTO market_clock (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  );
}

export function nowMs(clockRow: ClockRow): number {
  const real = Date.now();
  if (clockRow.rehearsal_base_ms === null || clockRow.rehearsal_set_real_ms === null) {
    return real;
  }
  // Postgres returns bigint columns as strings; parse before any arithmetic.
  const base = Number(clockRow.rehearsal_base_ms);
  const setReal = Number(clockRow.rehearsal_set_real_ms);
  return base + (real - setReal);
}

export async function getClockRow(): Promise<ClockRow> {
  const { rows } = await pool.query<ClockRow>(
    `SELECT id, rehearsal_base_ms, rehearsal_set_real_ms FROM market_clock WHERE id = 1`,
  );
  if (rows.length === 0) {
    await ensureClockRow();
    const retry = await pool.query<ClockRow>(
      `SELECT id, rehearsal_base_ms, rehearsal_set_real_ms FROM market_clock WHERE id = 1`,
    );
    return retry.rows[0] as ClockRow;
  }
  return rows[0] as ClockRow;
}

export async function setRehearsalClock(atIso: string | null): Promise<number> {
  const baseMs = atIso === null ? null : parseIsoInstant(atIso);
  if (atIso !== null && baseMs === null) {
    throw new Error("unparsable rehearsal instant");
  }
  const { rows } = await pool.query<ClockRow>(
    `UPDATE market_clock
       SET rehearsal_base_ms = $1::bigint,
           rehearsal_set_real_ms = CASE WHEN $1::bigint IS NULL THEN NULL ELSE $2::bigint END
     WHERE id = 1
     RETURNING id, rehearsal_base_ms, rehearsal_set_real_ms`,
    [baseMs === null ? null : String(baseMs), String(Date.now())],
  );
  if (rows.length === 0) {
    await ensureClockRow();
    return setRehearsalClock(atIso);
  }
  const row = rows[0] as ClockRow;
  if (row.rehearsal_base_ms === null) return Date.now();
  return row.rehearsal_base_ms;
}

export async function marketNow(): Promise<number> {
  const row = await getClockRow();
  return nowMs(row);
}

/** Runs `action` with a consistent clock read; the clock is fresh enough for the request's needs. */
export async function withMarketClock<T>(action: (now: number) => Promise<T>): Promise<T> {
  const now = await marketNow();
  return action(now);
}

export { parseIsoInstant };
