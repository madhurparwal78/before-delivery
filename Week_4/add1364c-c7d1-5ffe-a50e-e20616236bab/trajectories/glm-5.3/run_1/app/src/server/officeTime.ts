import { TZDate, tzOffset } from '@date-fns/tz';

export const OFFICE_ZONE = 'America/Chicago';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** A Postgres `date` value as a `YYYY-MM-DD` string, whatever shape it arrives in. */
export function asDateString(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }
  return String(value).slice(0, 10);
}

export interface OfficeDateParts {
  year: number;
  month: number;
  day: number;
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Offset abbreviation (CST/CDT) in effect at the instant. */
export function offsetAbbreviation(instant: Date): string {
  return tzOffset(OFFICE_ZONE, instant) === -360 ? 'CST' : 'CDT';
}

/** Office local date-time parts of an instant. */
export function officeParts(instant: Date): OfficeDateParts & { hour: number; minute: number; second: number } {
  const d = new TZDate(instant, OFFICE_ZONE);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() };
}

/** Office date string `YYYY-MM-DD` of an instant. */
export function officeDateString(instant: Date): string {
  const p = officeParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Office time string `HH:MM` of an instant. */
export function officeTimeString(instant: Date): string {
  const p = officeParts(instant);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Published office date display: `Fri 1 Jan`. */
export function formatOfficeDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const local = new TZDate(y, m - 1, d, OFFICE_ZONE);
  return `${WEEKDAYS[local.getDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** Published office stamp: `Thu 5 Nov, 14:05 CST`. */
export function formatOfficeStamp(instant: Date): string {
  const p = officeParts(instant);
  const weekday = new TZDate(p.year, p.month - 1, p.day, OFFICE_ZONE).getDay();
  return `${WEEKDAYS[weekday]} ${p.day} ${MONTHS[p.month - 1]}, ${pad2(p.hour)}:${pad2(p.minute)} ${offsetAbbreviation(instant)}`;
}

/** The instant of an office midnight (00:00 office time) for a `YYYY-MM-DD` date string. */
export function officeMidnightInstant(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new TZDate(y, m - 1, d, 0, 0, OFFICE_ZONE);
}

/**
 * The instant of an office local `YYYY-MM-DDTHH:MM` wall-clock time.
 * A local time skipped by spring-forward moves to the first valid minute after the
 * gap opens — the transition instant (for example, 02:30 on the March change night
 * becomes 03:00 CDT and is marked `shifted`).
 * A local time repeated by fall-back means its first occurrence.
 */
export function officeLocalInstant(dateStr: string, time: string, second = 0): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guessed = new TZDate(y, m - 1, d, hh, mm, second, OFFICE_ZONE);
  if (guessed.getHours() === hh && guessed.getMinutes() === mm) return guessed;
  // The time is skipped: walk minute by minute from the day's midnight to the
  // transition instant, which is the first valid minute after the gap.
  const midnight = new TZDate(y, m - 1, d, 0, 0, OFFICE_ZONE);
  const baseOffset = tzOffset(OFFICE_ZONE, midnight);
  for (let minutes = 0; minutes < 24 * 60; minutes++) {
    const probe = new Date(midnight.getTime() + minutes * 60000);
    if (tzOffset(OFFICE_ZONE, probe) !== baseOffset) return probe;
  }
  return guessed;
}

/** Whether the office local minute `HH:MM` on a date exists exactly (not skipped by DST). */
export function isOfficeLocalMinuteSkipped(dateStr: string, time: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guessed = new TZDate(y, m - 1, d, hh, mm, OFFICE_ZONE);
  return guessed.getHours() !== hh || guessed.getMinutes() !== mm;
}

/** Offset abbreviation in effect at a date's office midnight. */
export function midnightOffset(dateStr: string): string {
  return offsetAbbreviation(officeMidnightInstant(dateStr));
}

/** Offset in minutes in effect at a date's office midnight. */
export function midnightOffsetMinutes(dateStr: string): number {
  return tzOffset(OFFICE_ZONE, officeMidnightInstant(dateStr)) / 60000;
}

/** Add days to a `YYYY-MM-DD` string, returning a `YYYY-MM-DD` string. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const shifted = new TZDate(y, m - 1, d + days, OFFICE_ZONE);
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}-${pad2(shifted.getDate())}`;
}

/** Day-of-week (0=Sunday) of a `YYYY-MM-DD` office date. */
export function officeDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new TZDate(y, m - 1, d, OFFICE_ZONE).getDay();
}

/** Whether an office date is a business day (Mon-Fri). */
export function isBusinessDay(dateStr: string): boolean {
  const dow = officeDayOfWeek(dateStr);
  return dow >= 1 && dow <= 5;
}

/**
 * The second office business day after a date: the published turn-due rule.
 * For example, from Thursday the answer is the following Monday.
 */
export function secondBusinessDayAfter(dateStr: string): string {
  let cursor = dateStr;
  let found = 0;
  while (found < 2) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor)) found += 1;
  }
  return cursor;
}

/** Parse `YYYY-MM-DD`; returns null when not a valid real date. */
export function parseOfficeDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new TZDate(y, m - 1, d, OFFICE_ZONE);
  if (probe.getFullYear() !== y || probe.getMonth() + 1 !== m || probe.getDate() !== d) return null;
  return value;
}

/** Parse `YYYY-MM`; returns null when invalid. */
export function parseMonth(value: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return value;
}

/** Parse `M/D/YYYY` (no leading zeros required); returns `YYYY-MM-DD` or null. */
export function parseLooseUsDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const m = Number(match[1]);
  const d = Number(match[2]);
  const y = Number(match[3]);
  const probe = new TZDate(y, m - 1, d, OFFICE_ZONE);
  if (probe.getFullYear() !== y || probe.getMonth() + 1 !== m || probe.getDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Number of days in a `YYYY-MM` month. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new TZDate(y, m, 0, OFFICE_ZONE).getDate();
}

/** First day (`YYYY-MM-01`) of the month containing a `YYYY-MM-DD` date. */
export function monthOfDate(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** Quarter label like `Q4 2026` for a `YYYY-MM-DD` date. */
export function quarterOfDate(dateStr: string): string {
  const year = dateStr.slice(0, 4);
  const quarter = Math.floor((Number(dateStr.slice(5, 7)) - 1) / 3) + 1;
  return `Q${quarter} ${year}`;
}

/** First calendar day of the quarter containing a date. */
export function quarterStart(dateStr: string): string {
  const year = Number(dateStr.slice(0, 4));
  const quarter = Math.floor((Number(dateStr.slice(5, 7)) - 1) / 3);
  return `${year}-${pad2(quarter * 3 + 1)}-01`;
}

/** UTC ISO 8601 with `Z` for an instant. */
export function toUtcIso(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, 'Z') === instant.toISOString()
    ? instant.toISOString()
    : instant.toISOString();
}

/** The nth occurrence of a weekday within a month, e.g. second Sunday of March. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string {
  const first = new TZDate(year, month - 1, 1, OFFICE_ZONE);
  const offset = (weekday - first.getDay() + 7) % 7;
  return `${year}-${pad2(month)}-${pad2(1 + offset + (nth - 1) * 7)}`;
}
