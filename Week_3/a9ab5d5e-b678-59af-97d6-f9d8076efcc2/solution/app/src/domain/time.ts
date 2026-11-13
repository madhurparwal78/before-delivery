/** Calendar dates as `YYYY-MM-DD`, instants as epoch milliseconds, zones as IANA names. */
export type PlainDate = string;

const MS_PER_DAY = 86400000;

export function isValidDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map((part) => Number.parseInt(part, 10)) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return daysInMonth(year, month) >= day;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function epochDay(date: PlainDate): number {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10)) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function dateFromEpochDay(day: number): PlainDate {
  const date = new Date(day * MS_PER_DAY);
  return toDateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function toDateString(year: number, month: number, day: number): PlainDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return dateFromEpochDay(epochDay(date) + days);
}

export function dateYear(date: PlainDate): number {
  return Number.parseInt(date.slice(0, 4), 10);
}

/** ISO weekday, Monday 1 through Sunday 7. */
export function isoWeekday(date: PlainDate): number {
  const day = ((epochDay(date) % 7) + 7) % 7;
  return day === 0 ? 4 : day < 4 ? day + 4 : day - 3;
}

export function compareDates(a: PlainDate, b: PlainDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const existing = formatters.get(zone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(zone, created);
  return created;
}

export function isValidZone(zone: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]{1,80}$/.test(zone)) return false;
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(zone: string, epochMs: number): ZonedParts {
  const parts = formatterFor(zone).formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number.parseInt(found.value, 10) : 0;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Minutes east of UTC in `zone` at `epochMs`. */
function offsetMinutes(zone: string, epochMs: number): number {
  const parts = zonedParts(zone, epochMs);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000);
}

export function localDate(zone: string, epochMs: number): PlainDate {
  const parts = zonedParts(zone, epochMs);
  return toDateString(parts.year, parts.month, parts.day);
}

export function localMinuteOfDay(zone: string, epochMs: number): number {
  const parts = zonedParts(zone, epochMs);
  return parts.hour * 60 + parts.minute;
}

type WallClockResolution = 'exact' | 'gap' | 'fold';

interface WallClockResult {
  epochMs: number;
  resolution: WallClockResolution;
}

/** Temporal's `compatible` disambiguation: a gap moves forward, a fold takes the earlier offset. */
export function wallClockToInstant(zone: string, date: PlainDate, minuteOfDay: number): WallClockResult {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10)) as [number, number, number];
  const naive = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  const offsetBefore = offsetMinutes(zone, naive - MS_PER_DAY);
  const offsetAfter = offsetMinutes(zone, naive + MS_PER_DAY);
  const valid: number[] = [];
  for (const offset of offsetBefore === offsetAfter ? [offsetBefore] : [offsetBefore, offsetAfter]) {
    const candidate = naive - offset * 60000;
    if (offsetMinutes(zone, candidate) === offset) valid.push(candidate);
  }
  if (valid.length === 1) return { epochMs: valid[0] as number, resolution: 'exact' };
  if (valid.length > 1) return { epochMs: Math.min(...valid), resolution: 'fold' };
  return { epochMs: naive - offsetBefore * 60000, resolution: 'gap' };
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

/** RFC 3339 with the governing zone's numeric offset and no fractional seconds. */
export function formatInstant(zone: string, epochMs: number): string {
  const parts = zonedParts(zone, epochMs);
  const offset = offsetMinutes(zone, epochMs);
  return (
    `${toDateString(parts.year, parts.month, parts.day)}T` +
    `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}` +
    formatOffset(offset)
  );
}

const instantPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|([+-])(\d{2}):(\d{2}))$/;

export function parseInstant(text: string): number | null {
  const match = instantPattern.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = match;
  const year = Number.parseInt(y as string, 10);
  const month = Number.parseInt(mo as string, 10);
  const day = Number.parseInt(d as string, 10);
  const hour = Number.parseInt(h as string, 10);
  const minute = Number.parseInt(mi as string, 10);
  const second = Number.parseInt(s as string, 10);
  if (!isValidDate(toDateString(year, month, day))) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offset = 0;
  if (sign !== undefined) {
    const offsetHours = Number.parseInt(oh as string, 10);
    const offsetMinutesPart = Number.parseInt(om as string, 10);
    if (offsetHours > 23 || offsetMinutesPart > 59) return null;
    offset = (offsetHours * 60 + offsetMinutesPart) * (sign === '-' ? -1 : 1);
  }
  return Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60000;
}

export function isOnTheMinute(epochMs: number): boolean {
  return epochMs % 60000 === 0;
}

/** Western Easter Sunday by the Gregorian computus. */
export function easterSunday(year: number): PlainDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toDateString(year, month, day);
}

/** The nth ISO weekday of a month, or null when that month has no such weekday. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): PlainDate | null {
  if (n === -1) {
    const last = daysInMonth(year, month);
    for (let day = last; day >= last - 6; day -= 1) {
      const date = toDateString(year, month, day);
      if (isoWeekday(date) === weekday) return date;
    }
    return null;
  }
  const firstDate = toDateString(year, month, 1);
  const firstWeekday = isoWeekday(firstDate);
  const shift = (weekday - firstWeekday + 7) % 7;
  const day = 1 + shift + (n - 1) * 7;
  if (day > daysInMonth(year, month)) return null;
  return toDateString(year, month, day);
}

export function minutesToHhMm(minuteOfDay: number): string {
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
}
