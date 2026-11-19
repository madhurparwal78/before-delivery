/** The Federal Reserve calendar: observed holidays and business days. */
import { addDays, weekdayOf } from "./clock.js";

const SUNDAY = 0;
const MONDAY = 1;
const SATURDAY = 6;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** The nth (1-based) given weekday of a month, as a date. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  let date = `${year}-${pad(month)}-01`;
  while (weekdayOf(date) !== weekday) date = addDays(date, 1);
  return addDays(date, 7 * (nth - 1));
}

/** The last Monday of May. */
function memorialDay(year: number): string {
  let date = `${year}-05-31`;
  while (weekdayOf(date) !== MONDAY) date = addDays(date, -1);
  return date;
}

/** A fixed-date holiday: a Sunday one is observed the next Monday, a Saturday one is not moved. */
function fixedHoliday(year: number, month: number, day: number): string | null {
  const date = `${year}-${pad(month)}-${pad(day)}`;
  const weekday = weekdayOf(date);
  if (weekday === SUNDAY) return addDays(date, 1);
  if (weekday === SATURDAY) return null;
  return date;
}

const holidayCache = new Map<number, Set<string>>();

function observedHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const found = new Set<string>();
  const add = (date: string | null) => {
    if (date) found.add(date);
  };
  add(fixedHoliday(year, 1, 1));
  add(nthWeekday(year, 1, MONDAY, 3));
  add(nthWeekday(year, 2, MONDAY, 3));
  add(memorialDay(year));
  add(fixedHoliday(year, 6, 19));
  add(fixedHoliday(year, 7, 4));
  add(nthWeekday(year, 9, MONDAY, 1));
  add(nthWeekday(year, 10, MONDAY, 2));
  add(fixedHoliday(year, 11, 11));
  add(nthWeekday(year, 11, 4, 4));
  add(fixedHoliday(year, 12, 25));
  holidayCache.set(year, found);
  return found;
}

export function isBusinessDay(date: string): boolean {
  const weekday = weekdayOf(date);
  if (weekday === SUNDAY || weekday === SATURDAY) return false;
  return !observedHolidays(Number.parseInt(date.slice(0, 4), 10)).has(date);
}

/** The first business day on or after a date. */
export function businessDayOnOrAfter(date: string): string {
  let day = date;
  while (!isBusinessDay(day)) day = addDays(day, 1);
  return day;
}

/** The first business day strictly after a date. */
export function nextBusinessDay(date: string): string {
  return businessDayOnOrAfter(addDays(date, 1));
}

/** The date `count` business days strictly after a date. */
export function businessDaysAfter(date: string, count: number): string {
  let day = date;
  for (let counted = 0; counted < count; counted++) day = nextBusinessDay(day);
  return day;
}
