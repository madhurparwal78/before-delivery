/**
 * The one place where office time is decided: America/Chicago conversion, the
 * daylight-saving rule for local times that do not exist or repeat, office
 * business days and every published date format.
 */

export const TIME_ZONE = 'America/Chicago';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const fieldFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const zoneFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  timeZoneName: 'short',
});

export type OfficeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type OfficeDate = string;
export type OfficeOffset = 'CST' | 'CDT';

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function officeParts(at: Date): OfficeParts {
  const read: Record<string, string> = {};
  for (const part of fieldFormat.formatToParts(at)) read[part.type] = part.value;
  return {
    year: Number(read.year),
    month: Number(read.month),
    day: Number(read.day),
    hour: Number(read.hour),
    minute: Number(read.minute),
    second: Number(read.second),
  };
}

/** Milliseconds to add to an instant to read its office wall clock as if it were UTC. */
function zoneShift(at: Date): number {
  const parts = officeParts(at);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - at.getTime();
}

export function officeDate(at: Date): OfficeDate {
  const parts = officeParts(at);
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

export function officeTimeOfDay(at: Date): string {
  const parts = officeParts(at);
  return `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}`;
}

export function officeLocal(at: Date): string {
  return `${officeDate(at)}T${officeTimeOfDay(at)}`;
}

export function officeOffset(at: Date): OfficeOffset {
  for (const part of zoneFormat.formatToParts(at)) {
    if (part.type === 'timeZoneName') return part.value === 'CDT' ? 'CDT' : 'CST';
  }
  return 'CST';
}

export function officeMonth(at: Date): string {
  return officeDate(at).slice(0, 7);
}

export function isOfficeDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function isOfficeMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
}

export function isOfficeTimeOfDay(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number) as [number, number];
  return hour < 24 && minute < 60;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Reads an office local date and time as an instant. A local time skipped by
 * spring-forward moves to the first valid minute after it; a local time
 * repeated by fall-back means its first occurrence.
 */
export function officeLocalToInstant(date: OfficeDate, time: string): { at: Date; shifted: boolean } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let step = 0; step <= 24 * 60; step += 1) {
    const target = wanted + step * 60_000;
    const resolved = exactLocal(target);
    if (resolved !== null) return { at: resolved, shifted: step > 0 };
  }
  throw new Error(`Unresolvable office local time: ${date}T${time}`);
}

/** The earliest instant whose office wall clock equals the given clock reading, or null when none does. */
function exactLocal(wanted: number): Date | null {
  const candidates = [wanted - zoneShift(new Date(wanted - 12 * 3_600_000)), wanted - zoneShift(new Date(wanted + 12 * 3_600_000))];
  for (const candidate of [...new Set(candidates)].sort((a, b) => a - b)) {
    const at = new Date(candidate);
    const parts = officeParts(at);
    const roundTrip = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    if (roundTrip === wanted) return at;
  }
  return null;
}

export function officeMidnight(date: OfficeDate): Date {
  return officeLocalToInstant(date, '00:00').at;
}

export function addOfficeDays(date: OfficeDate, days: number): OfficeDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1, 2)}-${pad(moved.getUTCDate(), 2)}`;
}

export function officeDayOfWeek(date: OfficeDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isOfficeBusinessDay(date: OfficeDate): boolean {
  const weekday = officeDayOfWeek(date);
  return weekday >= 1 && weekday <= 5;
}

/** The nth office business day strictly after the given office date. */
export function officeBusinessDaysAfter(date: OfficeDate, count: number): OfficeDate {
  let cursor = date;
  let seen = 0;
  while (seen < count) {
    cursor = addOfficeDays(cursor, 1);
    if (isOfficeBusinessDay(cursor)) seen += 1;
  }
  return cursor;
}

/** The nth office business day of a run of days, counting the first business day as the first. */
export function nthOfficeBusinessDayFrom(start: OfficeDate, count: number): OfficeDate {
  let cursor = start;
  let seen = 0;
  for (;;) {
    if (isOfficeBusinessDay(cursor)) {
      seen += 1;
      if (seen === count) return cursor;
    }
    cursor = addOfficeDays(cursor, 1);
  }
}

export function quarterOf(date: OfficeDate): { year: number; quarter: number } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return { year, quarter: Math.floor((month - 1) / 3) + 1 };
}

export function quarterLabel(date: OfficeDate): string {
  const { year, quarter } = quarterOf(date);
  return `Q${quarter} ${year}`;
}

export function quarterFirstDay(year: number, quarter: number): OfficeDate {
  return `${pad(year, 4)}-${pad((quarter - 1) * 3 + 1, 2)}-01`;
}

export function compareOfficeDates(left: OfficeDate, right: OfficeDate): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** `<office date>`, for example `Fri 1 Jan`. */
export function formatOfficeDate(date: OfficeDate): string {
  const day = Number(date.slice(8, 10));
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  return `${WEEKDAYS[officeDayOfWeek(date)]} ${day} ${month}`;
}

/** `<office date> <year>`, used by the night ruler's value text. */
export function formatOfficeDateWithYear(date: OfficeDate): string {
  return `${formatOfficeDate(date)} ${date.slice(0, 4)}`;
}

/** `<office stamp>`, for example `Thu 5 Nov, 14:05 CST`. */
export function formatOfficeStamp(at: Date): string {
  return `${formatOfficeDate(officeDate(at))}, ${officeTimeOfDay(at)} ${officeOffset(at)}`;
}

export function nextOfficeTimeAfter(at: Date, time: string): Date {
  const sameDay = officeLocalToInstant(officeDate(at), time).at;
  if (sameDay.getTime() > at.getTime()) return sameDay;
  return officeLocalToInstant(addOfficeDays(officeDate(at), 1), time).at;
}
