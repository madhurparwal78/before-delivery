// Regular-session hours, holidays and early closes. The one place that decides whether the
// equity session is open, what its close is, and which closes a clock has passed.

import { many, text, type Queryable } from "./db.ts";
import { addCalendarDays, newYorkDate, parseCalendarDate, wallTimeToInstant, weekdayOf } from "../shared/newyork.ts";

export const HOLIDAYS_2026: ReadonlyArray<readonly [string, string]> = [
  ["2026-01-01", "New Year's Day"],
  ["2026-01-19", "Martin Luther King Jr. Day"],
  ["2026-02-16", "Washington's Birthday"],
  ["2026-04-03", "Good Friday"],
  ["2026-05-25", "Memorial Day"],
  ["2026-06-19", "Juneteenth"],
  ["2026-07-03", "Independence Day (observed)"],
  ["2026-09-07", "Labor Day"],
  ["2026-11-26", "Thanksgiving Day"],
  ["2026-12-25", "Christmas Day"],
];

export const EARLY_CLOSES_2026: readonly string[] = ["2026-11-27", "2026-12-24"];

interface SpecialDay {
  holiday: string | null;
  earlyClose: boolean;
}

const special = new Map<string, SpecialDay>();

export async function loadCalendar(q: Queryable): Promise<void> {
  const rows = await many(q, "SELECT date::text AS date, holiday, early_close FROM session_calendar");
  special.clear();
  for (const row of rows) {
    const holiday = row["holiday"];
    special.set(text(row, "date"), { holiday: typeof holiday === "string" ? holiday : null, earlyClose: row["early_close"] === true });
  }
}

interface SessionDay {
  date: string;
  tradingDay: boolean;
  holiday: string | null;
  opensAt: number | null;
  closesAt: number | null;
  earlyClose: boolean;
}

function wallInstant(date: string, hour: number, minute: number): number {
  const instant = wallTimeToInstant(date, hour, minute, 0);
  if (instant === null) throw new RangeError("session time does not exist");
  return instant;
}

export function sessionDay(date: string): SessionDay {
  const entry = special.get(date);
  const weekday = weekdayOf(date);
  const holiday = entry?.holiday ?? null;
  const tradingDay = weekday >= 1 && weekday <= 5 && holiday === null;
  if (!tradingDay) return { date, tradingDay, holiday, opensAt: null, closesAt: null, earlyClose: false };
  const earlyClose = entry?.earlyClose === true;
  return { date, tradingDay, holiday, opensAt: wallInstant(date, 9, 30), closesAt: wallInstant(date, earlyClose ? 13 : 16, 0), earlyClose };
}

interface EquitySession {
  date: string;
  status: "open" | "closed";
  closesAt: number | null;
}

export function equitySessionAt(instant: number): EquitySession {
  const date = newYorkDate(instant);
  const day = sessionDay(date);
  const open = day.opensAt !== null && day.closesAt !== null && instant >= day.opensAt && instant < day.closesAt;
  return { date, status: open ? "open" : "closed", closesAt: open ? day.closesAt : null };
}

export function isCalendarYear2026(date: string): boolean {
  return parseCalendarDate(date)?.year === 2026;
}

/** Trading days strictly after `afterDate` whose close is at or before `instant`, oldest first. */
export function closesPassed(afterDate: string, instant: number): SessionDay[] {
  const passed: SessionDay[] = [];
  let date = addCalendarDays(afterDate, 1);
  const last = newYorkDate(instant);
  while (date <= last) {
    const day = sessionDay(date);
    if (day.closesAt !== null && day.closesAt <= instant) passed.push(day);
    date = addCalendarDays(date, 1);
  }
  return passed;
}
