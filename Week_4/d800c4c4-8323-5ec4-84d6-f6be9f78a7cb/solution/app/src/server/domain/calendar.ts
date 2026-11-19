// The opening calendar: open days, due dates, closing instants and open-day lateness.
import type { Db } from "../db.js";
import { rows } from "../db.js";
import { addDays, localDate, wallClockInstant, weekdayOf, type Weekday } from "./time.js";

export interface Hours {
  opens: string;
  closes: string;
}

export interface Calendar {
  zone: string;
  hours: Map<Weekday, Hours>;
  closures: Set<string>;
}

export interface Settings {
  time_zone: string;
  late_fee_cents: number;
  damage_fee_cents: number;
  loan_period_days: number;
}

export async function loadSettings(db: Db): Promise<Settings> {
  const [settings] = await rows<Settings>(
    db,
    `SELECT time_zone, late_fee_cents, damage_fee_cents, loan_period_days FROM settings WHERE id = 1`,
  );
  return settings!;
}

export async function loadCalendar(db: Db): Promise<Calendar> {
  const [settings, hours, closures] = await Promise.all([
    loadSettings(db),
    rows<{ weekday: Weekday; opens: string; closes: string }>(db, `SELECT weekday, opens, closes FROM opening_hours`),
    rows<{ date: string }>(db, `SELECT date FROM closures`),
  ]);
  return {
    zone: settings.time_zone,
    hours: new Map(hours.map((h) => [h.weekday, { opens: h.opens, closes: h.closes }])),
    closures: new Set(closures.map((c) => c.date)),
  };
}

export function isOpenDay(calendar: Calendar, date: string): boolean {
  return calendar.hours.has(weekdayOf(date)) && !calendar.closures.has(date);
}

export function firstOpenDayFrom(calendar: Calendar, date: string): string {
  let day = date;
  while (!isOpenDay(calendar, day)) day = addDays(day, 1);
  return day;
}

export function nextOpenDayAfter(calendar: Calendar, date: string): string {
  return firstOpenDayFrom(calendar, addDays(date, 1));
}

export function nextOpenDays(calendar: Calendar, today: string, count: number): string[] {
  const days: string[] = [];
  let day = firstOpenDayFrom(calendar, today);
  while (days.length < count) {
    days.push(day);
    day = nextOpenDayAfter(calendar, day);
  }
  return days;
}

/** A loan is due on the first open day on or after its library-local checkout date plus the loan period. */
export function dueDateFor(calendar: Calendar, checkedOutAt: number, loanPeriodDays: number): string {
  return firstOpenDayFrom(calendar, addDays(localDate(calendar.zone, checkedOutAt), loanPeriodDays));
}

/** `due_by` is the closing time currently set for the due date's weekday. */
export function dueBy(calendar: Calendar, dueDate: string): string | null {
  return calendar.hours.get(weekdayOf(dueDate))?.closes ?? null;
}

/** The closing instant of an open day: HH:MM:00 library wall-clock time at the offset in force then. */
function closingInstant(calendar: Calendar, date: string): number {
  const closes = calendar.hours.get(weekdayOf(date))!.closes;
  return wallClockInstant(calendar.zone, date, `${closes}:00`, false);
}

function effectiveReturnDay(calendar: Calendar, returnedAt: number): string {
  const date = localDate(calendar.zone, returnedAt);
  if (isOpenDay(calendar, date) && returnedAt <= closingInstant(calendar, date)) return date;
  return nextOpenDayAfter(calendar, date);
}

/** Open days strictly after the due date, up to and including the effective return day. */
export function openDaysLate(calendar: Calendar, dueDate: string, returnedAt: number): number {
  const end = effectiveReturnDay(calendar, returnedAt);
  let count = 0;
  for (let day = addDays(dueDate, 1); day <= end; day = addDays(day, 1)) {
    if (isOpenDay(calendar, day)) count += 1;
  }
  return count;
}

export function today(calendar: Calendar, now: number): string {
  return localDate(calendar.zone, now);
}
