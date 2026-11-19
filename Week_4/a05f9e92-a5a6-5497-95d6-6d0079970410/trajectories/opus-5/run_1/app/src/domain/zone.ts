/**
 * IANA zone arithmetic. A schedule or rotation time is a wall-clock time in its
 * zone. A wall time inside the spring gap moves forward by the length of the gap;
 * a wall time in the autumn overlap means its first occurrence.
 */

export interface WallTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of an instant in a zone. */
export function wallOf(instant: Date | number, zone: string): WallTime {
  const ms = typeof instant === 'number' ? instant : instant.getTime();
  const parts = partsFormatter(zone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Milliseconds to add to UTC to read local wall time in this zone at this instant. */
function offsetAt(zone: string, ms: number): number {
  const floored = Math.floor(ms / 1000) * 1000;
  const w = wallOf(floored, zone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - floored;
}

/** The instant a wall-clock time names in a zone, by the published gap and overlap rules. */
export function instantOf(zone: string, wall: WallTime): number {
  const wallMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const before = offsetAt(zone, wallMs - 86_400_000);
  const after = offsetAt(zone, wallMs + 86_400_000);
  const candidates = [...new Set([before, after])]
    .map((o) => wallMs - o)
    .filter((t) => offsetAt(zone, t) === wallMs - t);
  if (candidates.length > 0) return Math.min(...candidates);
  // Inside the spring gap: the wall time moves forward by the length of the gap.
  return wallMs - Math.min(before, after);
}

export function zoneOffsetMinutes(zone: string, instant: Date | number): number {
  const ms = typeof instant === 'number' ? instant : instant.getTime();
  return offsetAt(zone, ms) / 60_000;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The ISO offset of a zone at an instant, for example `+01:00`. */
export function offsetText(zone: string, instant: Date | number): string {
  const minutes = zoneOffsetMinutes(zone, instant);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** An ISO instant written with the zone's offset, as drill-down filters are written. */
export function isoInZone(zone: string, instant: Date | number): string {
  const ms = typeof instant === 'number' ? instant : instant.getTime();
  const w = wallOf(ms, zone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${offsetText(zone, ms)}`;
}

/** The published display format `YYYY-MM-DD HH:mm`. */
export function displayTime(zone: string, instant: Date | number): string {
  const w = wallOf(instant, zone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}

export type LocalDate = string;

export function localDate(zone: string, instant: Date | number): LocalDate {
  const w = wallOf(instant, zone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Not a local date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayKey = (typeof weekdayKeys)[number];

export function weekdayOf(date: LocalDate): WeekdayKey {
  const { year, month, day } = parseLocalDate(date);
  return weekdayKeys[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function weekdayName(date: LocalDate): string {
  const { year, month, day } = parseLocalDate(date);
  return weekdayNames[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function monthName(month: number): string {
  return monthNames[month - 1];
}

export function weekdayIndex(name: string): number {
  const i = weekdayNames.findIndex((w) => w.toLowerCase() === name.toLowerCase());
  return i;
}

/** The instant of midnight starting a local date in a zone. */
export function startOfLocalDate(zone: string, date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return instantOf(zone, { year, month, day, hour: 0, minute: 0, second: 0 });
}

/**
 * The instant of a wall time written `HH:mm` on a local date. `24:00` means
 * midnight starting the next local date, so an all-day window covers the whole
 * local day however long daylight saving makes it.
 */
export function wallTimeOn(zone: string, date: LocalDate, hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Not a wall time: ${hhmm}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour >= 24) return startOfLocalDate(zone, addDays(date, 1));
  const { year, month, day } = parseLocalDate(date);
  return instantOf(zone, { year, month, day, hour, minute, second: 0 });
}

/** Parses the `YYYY-MM-DD HH:mm` form typed in rule and settings forms. */
export function parseDisplayTime(zone: string, text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  return instantOf(zone, {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: 0,
  });
}

/** The start of the ISO week (Monday) containing a local date. */
export function startOfWeek(date: LocalDate): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}
