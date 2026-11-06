import { all } from "../db";
import { calendarDate } from "../time";
import { clubTimeZone } from "./club";

export interface DayRow {
  date: string;
  units_pledged: number;
  units_withdrawn: number;
}

/** Pledges counted on the club-local calendar date they were accepted. */
export function pledgesByDay(cycleId: string): { time_zone: string; days: DayRow[] } {
  const tz = clubTimeZone();
  const events = all<{ delta_units: number; accepted_at: number }>(
    "SELECT delta_units, accepted_at FROM pledge_events WHERE cycle_id = ? ORDER BY accepted_at",
    cycleId
  );
  const byDate = new Map<string, DayRow>();
  for (const e of events) {
    const date = calendarDate(e.accepted_at, tz);
    const row = byDate.get(date) ?? { date, units_pledged: 0, units_withdrawn: 0 };
    if (e.delta_units > 0) row.units_pledged += e.delta_units;
    else row.units_withdrawn += -e.delta_units;
    byDate.set(date, row);
  }
  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { time_zone: tz, days };
}
