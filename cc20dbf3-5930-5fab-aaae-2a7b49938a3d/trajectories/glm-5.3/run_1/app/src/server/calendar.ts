import { addDays, dateDiff, weekdayOf, zonedInstant } from "./time";

export interface LibraryCalendar {
  timeZone: string;
  openDays: readonly string[];
  closedDates: readonly string[];
  openingTime: string;
  closingTime: string;
  lateFeeSchedule: readonly { effective_from: string; cents_per_day: number }[];
}

export interface LateFeeEntry {
  effective_from: string;
  cents_per_day: number;
}

const MINUTES_PER_DAY = 86400000;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** The one open-day definition, used by holds, walk-ins, renewals, back_on, late days and lane cells. */
export function isOpenDay(calendar: LibraryCalendar, date: string): boolean {
  if (calendar.closedDates.includes(date)) return false;
  return calendar.openDays.includes(weekdayOf(date));
}

/** The first open day strictly after the given date. */
export function nextOpenDay(calendar: LibraryCalendar, date: string): string {
  let candidate = addDays(date, 1);
  // A run of closures is bounded by the calendar's reach; guard with a sane cap.
  for (let i = 0; i < 400; i++) {
    if (isOpenDay(calendar, candidate)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

/** The closing instant of a date, converted with the UTC offset in force on that date itself. */
export function closingInstant(calendar: LibraryCalendar, date: string): Date {
  const [h, m] = calendar.closingTime.split(":").map(Number);
  return zonedInstant(date, h, m, calendar.timeZone);
}

/** The open days, from the due date onward, whose closing instants are strictly before the return instant. */
export function lateDays(calendar: LibraryCalendar, dueDate: string, returnedAt: Date): string[] {
  const days: string[] = [];
  let cursor: string | null = isOpenDay(calendar, dueDate) ? dueDate : nextOpenDay(calendar, dueDate);
  while (cursor !== null && closingInstant(calendar, cursor).getTime() < returnedAt.getTime()) {
    days.push(cursor);
    if (days.length > 3650) break;
    cursor = nextOpenDay(calendar, cursor);
  }
  return days;
}

/** The rate in force on a late day's own local date, from the ascending seeded schedule. */
export function rateForDate(schedule: readonly LateFeeEntry[], date: string): number {
  let current: LateFeeEntry | null = null;
  for (const entry of schedule) {
    if (dateDiff(entry.effective_from, date) >= 0) {
      current = entry;
    }
  }
  return current === null ? schedule[0].cents_per_day : current.cents_per_day;
}

/** The summed, capped late fee in whole cents, fixed once at settlement. */
export function lateFeeCents(
  calendar: LibraryCalendar,
  lateDayDates: readonly string[],
  replacementCents: number,
): number {
  let total = 0;
  for (const day of lateDayDates) {
    total += rateForDate(calendar.lateFeeSchedule, day);
  }
  return Math.min(total, replacementCents);
}

export function openingInstant(calendar: LibraryCalendar, date: string): Date {
  const [h, m] = calendar.openingTime.split(":").map(Number);
  return zonedInstant(date, h, m, calendar.timeZone);
}

export const DAY_MS = MINUTES_PER_DAY;
