/**
 * Wall time and instants. Business time is Europe/Rome; every town has its own
 * zone. Nothing here reads a device clock: callers pass the instant.
 */

export type Town = 'Turin' | 'London' | 'New York' | 'Kyoto' | 'Dubai';

export const TOWNS: readonly Town[] = ['Turin', 'London', 'New York', 'Kyoto', 'Dubai'];

export const TOWN_ZONE: Record<Town, string> = {
  Turin: 'Europe/Rome',
  London: 'Europe/London',
  'New York': 'America/New_York',
  Kyoto: 'Asia/Tokyo',
  Dubai: 'Asia/Dubai',
};

export const BUSINESS_ZONE = TOWN_ZONE.Turin;

export interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      era: 'short',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** The wall-clock reading in `zone` at the instant `ms`. */
export function wallAt(zone: string, ms: number): Wall {
  const parts = formatter(zone).formatToParts(new Date(ms));
  const get = (t: Intl.DateTimeFormatPartTypes): string => {
    for (const p of parts) if (p.type === t) return p.value;
    throw new Error(`missing ${t}`);
  };
  const bc = get('era').toLowerCase().startsWith('b');
  const year = Number(get('year')) * (bc ? -1 : 1);
  const hour = Number(get('hour')) % 24;
  return {
    year,
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

/** The zone's offset from UTC in milliseconds at the instant `ms`. */
export function offsetAt(zone: string, ms: number): number {
  const w = wallAt(zone, ms);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export type WallResolution =
  | { kind: 'exact'; ms: number }
  | { kind: 'repeated'; ms: number }
  | { kind: 'absent' };

const DAY_MS = 86_400_000;

/**
 * Turns a wall-clock reading into an instant. A reading that happens twice
 * resolves to the first of the two; one that never happens is `absent`.
 */
export function resolveWall(zone: string, w: Wall): WallResolution {
  const target = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const probes = [target - DAY_MS, target, target + DAY_MS];
  const found: number[] = [];
  for (const p of probes) {
    const candidate = target - offsetAt(zone, p);
    if (found.includes(candidate)) continue;
    const back = wallAt(zone, candidate);
    if (
      back.year === w.year &&
      back.month === w.month &&
      back.day === w.day &&
      back.hour === w.hour &&
      back.minute === w.minute &&
      back.second === w.second
    ) {
      found.push(candidate);
    }
  }
  if (found.length === 0) return { kind: 'absent' };
  const ms = Math.min(...found);
  return found.length > 1 ? { kind: 'repeated', ms } : { kind: 'exact', ms };
}

/** The instant of a wall reading, or null when that reading does not exist. */
export function wallToInstant(zone: string, w: Wall): number | null {
  const r = resolveWall(zone, w);
  return r.kind === 'absent' ? null : r.ms;
}

/** The next instant after `fromMs` at which the zone's offset changes. */
export function nextZoneTransition(zone: string, fromMs: number): number {
  const startOffset = offsetAt(zone, fromMs);
  let low = fromMs;
  for (let day = 1; day <= 400; day += 1) {
    const high = fromMs + day * DAY_MS;
    if (offsetAt(zone, high) === startOffset) {
      low = high;
      continue;
    }
    // The change sits in (low, high]; narrow it to the second.
    let a = low;
    let b = high;
    while (b - a > 1000) {
      const mid = a + Math.floor((b - a) / 2);
      if (offsetAt(zone, mid) === startOffset) a = mid;
      else b = mid;
    }
    return b;
  }
  throw new Error('no zone transition found');
}

// ---------------------------------------------------------------- date strings

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_TEXT = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Reads `YYYY-MM-DD`, checking the day exists in that month. */
export function parseDate(text: string): CalendarDate | null {
  const m = DATE_TEXT.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Reads 24-hour `HH:MM`. */
export function parseTime(text: string): { hour: number; minute: number } | null {
  const m = TIME_TEXT.exec(text);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dateText(d: CalendarDate): string {
  return `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export function timeText(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** The local date in `zone` at the instant `ms`, as `YYYY-MM-DD`. */
export function localDate(zone: string, ms: number): string {
  const w = wallAt(zone, ms);
  return dateText(w);
}

/** The local time in `zone` at the instant `ms`, as `HH:MM` with seconds dropped. */
export function localTime(zone: string, ms: number): string {
  const w = wallAt(zone, ms);
  return timeText(w.hour, w.minute);
}

/** An instant rounded up to a whole minute, as `HH:MM` in `zone`. */
export function localMinuteCeil(zone: string, ms: number): string {
  const up = Math.ceil(ms / 60_000) * 60_000;
  return localTime(zone, up);
}

/** Whole-second UTC with a Z. */
export function instantText(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Days between two calendar dates, b - a. */
export function dayDiff(a: CalendarDate, b: CalendarDate): number {
  const ad = Date.UTC(a.year, a.month - 1, a.day);
  const bd = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bd - ad) / DAY_MS);
}

export function addDays(d: CalendarDate, n: number): CalendarDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day) + n * DAY_MS);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 1 = Monday through 7 = Sunday. */
export function isoWeekday(d: CalendarDate): number {
  const dow = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function mondayOf(d: CalendarDate): CalendarDate {
  return addDays(d, 1 - isoWeekday(d));
}

/** The instant one second before midnight ending the given local date. */
export function endOfLocalDay(zone: string, d: CalendarDate): number {
  const r = resolveWall(zone, { ...d, hour: 23, minute: 59, second: 59 });
  if (r.kind !== 'absent') return r.ms;
  const next = resolveWall(zone, { ...addDays(d, 1), hour: 0, minute: 0, second: 0 });
  if (next.kind === 'absent') throw new Error('no midnight');
  return next.ms - 1000;
}

/** The instant a local day starts at the given wall hour, skipping forward over a gap. */
export function startOfLocalDayAt(zone: string, d: CalendarDate, hour: number, minute = 0): number {
  for (let h = hour; h < hour + 6; h += 1) {
    const r = resolveWall(zone, { ...d, hour: h, minute, second: 0 });
    if (r.kind !== 'absent') return r.ms;
  }
  throw new Error('no start of day');
}

// ----------------------------------------------------------------- formatting

const EN_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Mon 29 Mar 2027`, the desk's own date form. */
export function englishDate(d: CalendarDate): string {
  return `${EN_DAYS[isoWeekday(d) - 1]} ${d.day} ${EN_MONTHS[d.month - 1]} ${d.year}`;
}

/** `Mon 29 Mar 2027` on the local date of `zone` at `ms`. */
export function englishDateAt(zone: string, ms: number): string {
  return englishDate(wallAt(zone, ms));
}

/** `Mon 29 Mar 2027, 06:20 Turin time`. */
export function englishDateTimeAt(zone: string, ms: number, town: Town): string {
  const w = wallAt(zone, ms);
  return `${englishDate(w)}, ${timeText(w.hour, w.minute)} ${town} time`;
}
