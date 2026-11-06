import type { LibraryCalendar, LocalDate } from '../../domain/calendar.js';
import type { LateFeeScheduleEntry } from '../../domain/lateFee.js';
import type { Database } from '../db/pool.js';

export interface LibrarySettings {
  readonly name: string;
  readonly calendar: LibraryCalendar;
  readonly lateFeeSchedule: readonly LateFeeScheduleEntry[];
  readonly maxActivePerMember: number;
}

interface LibraryRow {
  name: string;
  time_zone: string;
  open_days: string[];
  opening_time: string;
  closing_time: string;
  max_active_per_member: number;
}

export async function loadLibrarySettings(pool: Database): Promise<LibrarySettings> {
  const libraryResult = await pool.query<LibraryRow>(
    `select name, time_zone, open_days, opening_time, closing_time, max_active_per_member
     from library where id = 1`,
  );
  const row = libraryResult.rows[0];
  if (row === undefined) throw new Error('library settings missing');

  const closures = await pool.query<{ closed_on: LocalDate }>(
    `select closed_on from closure_date order by closed_on asc`,
  );
  const schedule = await pool.query<{ effective_from: LocalDate; cents_per_day: number }>(
    `select effective_from, cents_per_day from late_fee_schedule order by effective_from asc`,
  );

  return {
    name: row.name,
    calendar: {
      timeZone: row.time_zone,
      openDays: row.open_days,
      closedDates: closures.rows.map((closure) => closure.closed_on),
      openingTime: row.opening_time.slice(0, 5),
      closingTime: row.closing_time.slice(0, 5),
    },
    lateFeeSchedule: schedule.rows.map((entry) => ({
      effectiveFrom: entry.effective_from,
      centsPerDay: entry.cents_per_day,
    })),
    maxActivePerMember: row.max_active_per_member,
  };
}
