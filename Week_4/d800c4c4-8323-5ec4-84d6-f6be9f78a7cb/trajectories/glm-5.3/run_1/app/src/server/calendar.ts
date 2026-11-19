// The opening calendar: weekdays, hours, closures, open days, closing instants and due dates.
import { instantFromZoned, zonedParts, dateInZone } from './libraryTime';

export interface WeekdayHours {
  opens: string; // "HH:MM"
  closes: string; // "HH:MM"
}

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

export type HoursByWeekday = Partial<Record<Weekday, WeekdayHours>>;

export interface Closure {
  date: string; // YYYY-MM-DD in library time
  reason: string;
}

export interface Calendar {
  zone: string;
  hours: HoursByWeekday;
  closures: Map<string, string>; // date -> reason
}

/** Parse "YYYY-MM-DD" into parts. */
export function parseDate(date: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayIndex(date: string): number | null {
  const p = parseDate(date);
  if (p === null) return null;
  const utc = Date.UTC(p.year, p.month - 1, p.day);
  // getUTCDay: 0=Sunday. Convert to Monday=0.
  return (new Date(utc).getUTCDay() + 6) % 7;
}

export function isDateValid(date: string): boolean {
  const p = parseDate(date);
  if (p === null) return false;
  const utc = Date.UTC(p.year, p.month - 1, p.day);
  const back = new Date(utc);
  return back.getUTCFullYear() === p.year && back.getUTCMonth() === p.month - 1 && back.getUTCDate() === p.day;
}

export function addDays(date: string, days: number): string {
  const p = parseDate(date);
  if (p === null) throw new Error(`invalid date ${date}`);
  const utc = Date.UTC(p.year, p.month - 1, p.day) + days * 86400000;
  const d = new Date(utc);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** An open day has weekday hours and is not a closure. */
export function isOpenDay(calendar: Calendar, date: string): boolean {
  const idx = weekdayIndex(date);
  if (idx === null) return false;
  const weekday = WEEKDAYS[idx];
  if (weekday === undefined) return false;
  const h = calendar.hours[weekday];
  if (h === undefined) return false;
  return !calendar.closures.has(date);
}

/** Whether the weekday (by its hours, ignoring closures) opens at all. */
export function weekdayOpens(calendar: Calendar, date: string): boolean {
  const idx = weekdayIndex(date);
  if (idx === null) return false;
  const weekday = WEEKDAYS[idx];
  if (weekday === undefined) return false;
  return calendar.hours[weekday] !== undefined;
}

/** The closing instant: HH:MM:00 exactly in library wall-clock time at the offset then in force. */
export function closingInstant(calendar: Calendar, date: string): Date | null {
  const idx = weekdayIndex(date);
  if (idx === null) return null;
  const weekday = WEEKDAYS[idx];
  const h = weekday === undefined ? undefined : calendar.hours[weekday];
  if (h === undefined) return null;
  const [hh, mm] = h.closes.split(':').map(Number) as [number, number];
  const p = parseDate(date);
  if (p === null) return null;
  return instantFromZoned(calendar.zone, p.year, p.month, p.day, hh, mm, 0, 1);
}

/** The library-local date of an instant. */
export function localDate(calendar: Calendar, instant: Date): string {
  return dateInZone(instant, calendar.zone);
}

/**
 * Effective return day: the library-local date of the return when that date is open and the
 * return is at or before that date's closing instant; otherwise the next open day after it.
 */
export function effectiveReturnDay(calendar: Calendar, returnedAt: Date): string {
  const date = dateInZone(returnedAt, calendar.zone);
  const close = closingInstant(calendar, date);
  if (close !== null && !calendar.closures.has(date) && returnedAt.getTime() <= close.getTime()) {
    return date;
  }
  return nextOpenDayAfter(calendar, date);
}

/** The first open day strictly after the given date, unbounded. */
export function nextOpenDayAfter(calendar: Calendar, date: string): string {
  let probe = date;
  for (let i = 0; i < 4000; i++) {
    probe = addDays(probe, 1);
    if (isOpenDay(calendar, probe)) return probe;
  }
  throw new Error('no open day found within 4000 days');
}

/**
 * The due date: first open day on or after checkout date + loan period.
 */
export function dueDateFrom(calendar: Calendar, checkoutDate: string, loanPeriodDays: number): string {
  const target = addDays(checkoutDate, loanPeriodDays);
  let probe = target;
  for (let i = 0; i < 4000; i++) {
    if (isOpenDay(calendar, probe)) return probe;
    probe = addDays(probe, 1);
  }
  throw new Error('no open day found within 4000 days');
}

/**
 * Open days late: open days strictly after the due date, up to and including the effective return day.
 */
export function openDaysLate(calendar: Calendar, dueDate: string, effectiveDay: string): number {
  if (effectiveDay <= dueDate) return 0;
  let count = 0;
  let probe = dueDate;
  while (probe < effectiveDay) {
    probe = addDays(probe, 1);
    if (isOpenDay(calendar, probe)) count++;
  }
  return count;
}

/** The due_by string: closing time for the due date's weekday, as it currently stands. */
export function dueBy(calendar: Calendar, dueDate: string): string | null {
  const idx = weekdayIndex(dueDate);
  if (idx === null) return null;
  const weekday = WEEKDAYS[idx];
  const h = weekday === undefined ? undefined : calendar.hours[weekday];
  return h === undefined ? null : h.closes;
}

/** Today's library-local date. */
export function today(calendar: Calendar, now: Date): string {
  return dateInZone(now, calendar.zone);
}

/** The next 10 open days from today, inclusive of today when open. */
export function nextOpenDays(calendar: Calendar, now: Date): string[] {
  const out: string[] = [];
  let probe = today(calendar, now);
  for (let i = 0; i < 4000 && out.length < 10; i++) {
    if (isOpenDay(calendar, probe)) out.push(probe);
    probe = addDays(probe, 1);
  }
  return out;
}

/** Parse "HH:MM" returning minutes, or null. */
export function parseTimeMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (m === null) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** Validate a 24-hour quarter-hour time. */
export function isQuarterHourTime(value: string): boolean {
  const mins = parseTimeMinutes(value);
  return mins !== null && mins % 15 === 0;
}

export { zonedParts };
