/**
 * Venue-local calendar arithmetic. Every venue-local instant in the product
 * (install-day bounds, milestone due dates, quote validity, proration dates)
 * is decided here, so daylight-saving changes are handled in one place.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
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

/** The zone's offset from UTC, in milliseconds, at the given instant. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const w = wallClockIn(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, instant.getUTCMilliseconds());
  return asUtc - instant.getTime();
}

/** The venue-local calendar date of an instant, as YYYY-MM-DD. */
export function localDate(instant: Date, timeZone: string): string {
  const w = wallClockIn(instant, timeZone);
  return isoDate(w.year, w.month, w.day);
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function parseDate(date: string): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Calendar-day arithmetic on a YYYY-MM-DD string, free of any zone. */
export function addDays(date: string, days: number): string {
  const p = parseDate(date);
  if (!p) throw new Error(`bad date ${date}`);
  const t = Date.UTC(p.year, p.month - 1, p.day) + days * 86_400_000;
  const d = new Date(t);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole calendar days from `from` to `to`, both venue-local dates. */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) throw new Error('bad date');
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

/**
 * The instant at which the given venue-local wall time occurs. Resolved by
 * applying the zone offset that is actually in force at the candidate instant,
 * so instants on daylight-saving boundaries land correctly.
 */
export function instantAtLocal(
  date: string,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const p = parseDate(date);
  if (!p) throw new Error(`bad date ${date}`);
  const guess = Date.UTC(p.year, p.month - 1, p.day, hour, minute, second);
  const firstOffset = zoneOffsetMs(new Date(guess), timeZone);
  let candidate = new Date(guess - firstOffset);
  const secondOffset = zoneOffsetMs(candidate, timeZone);
  if (secondOffset !== firstOffset) candidate = new Date(guess - secondOffset);
  return candidate;
}

/** Venue-local midnight that opens the date. */
export function startOfDay(date: string, timeZone: string): Date {
  return instantAtLocal(date, 0, 0, 0, timeZone);
}

/**
 * The instant the date closes: the next date's venue-local midnight. A date
 * that changes to or from daylight saving time therefore lasts 23 or 25 hours.
 */
export function endOfDay(date: string, timeZone: string): Date {
  return startOfDay(addDays(date, 1), timeZone);
}

/** 23:59:59 venue-local on the date — the instant due dates and quotes expire. */
export function endOfDaySecond(date: string, timeZone: string): Date {
  return instantAtLocal(date, 23, 59, 59, timeZone);
}

/** Today's venue-local date. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDate(now, timeZone);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** ±HH:MM for the zone at the instant. */
export function offsetLabel(instant: Date, timeZone: string): string {
  const total = Math.round(zoneOffsetMs(instant, timeZone) / 60_000);
  const sign = total < 0 ? '-' : '+';
  const abs = Math.abs(total);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** ISO 8601 carrying the venue's UTC offset, for venue-related instants. */
export function isoWithVenueOffset(instant: Date, timeZone: string): string {
  const w = wallClockIn(instant, timeZone);
  return (
    `${isoDate(w.year, w.month, w.day)}T${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)}` +
    offsetLabel(instant, timeZone)
  );
}

/** ISO 8601 in UTC, for instants that are not venue-related. */
export function isoUtc(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** `<date>`: the venue-local calendar date as "Tue 16 Mar 2027". */
export function formatVenueDate(date: string): string {
  const p = parseDate(date);
  if (!p) throw new Error(`bad date ${date}`);
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] ?? '';
  return `${weekday} ${p.day} ${MONTHS[p.month - 1] ?? ''} ${p.year}`;
}

/** `<due>`: the date followed by ", 23:59:59 (<IANA zone>)". */
export function formatDue(date: string, timeZone: string): string {
  return `${formatVenueDate(date)}, 23:59:59 (${timeZone})`;
}

/** "March 2027" for the install-day calendar grid. */
export function formatMonthYear(year: number, month: number): string {
  return `${MONTHS_LONG[month - 1] ?? ''} ${year}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Weekday index (0 = Sunday) of a venue-local date. */
export function weekdayOf(date: string): number {
  const p = parseDate(date);
  if (!p) throw new Error(`bad date ${date}`);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}
