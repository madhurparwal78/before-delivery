// America/New_York calendar arithmetic. Every wall time becomes an instant here, using the
// offset in force on its own date; nothing adds fixed 24-hour or 7-day spans to an instant.

const MINUTE_MS = 60_000;
const EDT_MINUTES = -240;
const EST_MINUTES = -300;

interface NewYorkParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMinutes: number;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function nthSundayOfMonth(year: number, monthIndex: number, nth: number): number {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstWeekday) % 7);
  return firstSunday + 7 * (nth - 1);
}

function daylightSavingStart(year: number): number {
  return Date.UTC(year, 2, nthSundayOfMonth(year, 2, 2), 7);
}

function daylightSavingEnd(year: number): number {
  return Date.UTC(year, 10, nthSundayOfMonth(year, 10, 1), 6);
}

function offsetMinutesAt(instant: number): number {
  const year = new Date(instant).getUTCFullYear();
  return instant >= daylightSavingStart(year) && instant < daylightSavingEnd(year) ? EDT_MINUTES : EST_MINUTES;
}

function newYorkParts(instant: number): NewYorkParts {
  const offsetMinutes = offsetMinutesAt(instant);
  const shifted = new Date(instant + offsetMinutes * MINUTE_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
    offsetMinutes,
  };
}

function offsetText(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** ISO 8601 with the New York offset in force at that instant. */
export function formatInstant(instant: number): string {
  const p = newYorkParts(instant);
  const fraction = p.millisecond === 0 ? "" : `.${pad(p.millisecond, 3)}`;
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${fraction}${offsetText(p.offsetMinutes)}`;
}

export function newYorkDate(instant: number): string {
  const p = newYorkParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function parseCalendarDate(text: string): CalendarDate | null {
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function formatCalendarDate(date: CalendarDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

export function addCalendarDays(text: string, days: number): string {
  const date = parseCalendarDate(text);
  if (!date) throw new RangeError("not a calendar date");
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return formatCalendarDate({ year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() });
}

/** 0 is Sunday. */
export function weekdayOf(text: string): number {
  const date = parseCalendarDate(text);
  if (!date) throw new RangeError("not a calendar date");
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * The instant of a New York wall time, or null when that wall time does not exist.
 * A wall time that occurs twice (clocks falling back) means the earlier instant.
 */
export function wallTimeToInstant(dateText: string, hour: number, minute: number, second: number): number | null {
  const date = parseCalendarDate(dateText);
  if (!date) return null;
  const wallAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second);
  for (const offsetMinutes of [EDT_MINUTES, EST_MINUTES]) {
    const candidate = wallAsUtc - offsetMinutes * MINUTE_MS;
    if (offsetMinutesAt(candidate) === offsetMinutes) return candidate;
  }
  return null;
}

const WALL_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Parses `YYYY-MM-DD HH:MM:SS` (24-hour) as a New York wall time. */
export function parseWallTime(text: string): number | null {
  const match = WALL_PATTERN.exec(text);
  if (!match) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return wallTimeToInstant(match[1] ?? "", hour, minute, second);
}

function requireInstant(value: number | null): number {
  if (value === null) throw new RangeError("wall time does not exist");
  return value;
}

/** Start of a New York day. */
function dayStart(dateText: string): number {
  return requireInstant(wallTimeToInstant(dateText, 0, 0, 0));
}

/** The first instant after a New York day, which is the start of the next day. */
export function dayEnd(dateText: string): number {
  return dayStart(addCalendarDays(dateText, 1));
}

/** Sunday 23:59:59 of a holdings week. */
export function weekEndInstant(sundayText: string): number {
  return requireInstant(wallTimeToInstant(sundayText, 23, 59, 59));
}

export function weekStartDate(sundayText: string): string {
  return addCalendarDays(sundayText, -6);
}

/** The server writes every instant with its New York offset, so the leading digits are the New York wall time. */
export function isoWallDate(instant: string): string {
  return instant.slice(0, 10);
}

export function isoWallClock(instant: string, withSeconds: boolean): string {
  return instant.slice(11, withSeconds ? 19 : 16);
}
