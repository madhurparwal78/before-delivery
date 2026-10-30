import { PoolClient, Pool } from "pg";
import { LibraryCalendar, LateFeeEntry } from "../calendar";

export interface LibraryRow {
  name: string;
  time_zone: string;
  open_days: string[];
  closed_dates: string[];
  opening_time: string;
  closing_time: string;
  max_active_per_member: number;
}

export async function readLibrary(pool: Pool): Promise<LibraryRow> {
  const result = await pool.query(
    "SELECT name, time_zone, open_days, closed_dates, opening_time, closing_time, max_active_per_member FROM library WHERE id = 'library'",
  );
  const row = result.rows[0];
  return {
    name: row.name,
    time_zone: row.time_zone,
    open_days: row.open_days,
    closed_dates: row.closed_dates,
    opening_time: row.opening_time,
    closing_time: row.closing_time,
    max_active_per_member: row.max_active_per_member,
  };
}

export async function readLateFeeSchedule(pool: Pool): Promise<LateFeeEntry[]> {
  const result = await pool.query(
    "SELECT effective_from::text AS effective_from, cents_per_day FROM late_fee_schedule ORDER BY effective_from ASC",
  );
  return result.rows as LateFeeEntry[];
}

export function calendarOf(library: LibraryRow, schedule: readonly LateFeeEntry[]): LibraryCalendar {
  return {
    timeZone: library.time_zone,
    openDays: library.open_days,
    closedDates: [...library.closed_dates].sort(),
    openingTime: library.opening_time,
    closingTime: library.closing_time,
    lateFeeSchedule: schedule.map((entry) => ({ ...entry })),
  };
}

export async function readCalendar(pool: Pool): Promise<LibraryCalendar> {
  const library = await readLibrary(pool);
  const schedule = await readLateFeeSchedule(pool);
  return calendarOf(library, schedule);
}
