/**
 * All dates in the domain are athlete-local calendar dates (YYYY-MM-DD).
 * Instants are handled as epoch seconds. Wall-clock conversion uses
 * Intl with the athlete's IANA zone, so no tz database is required beyond
 * what Node ships.
 */

export type LocalDate = string; // YYYY-MM-DD
export type IsoWeek = string; // YYYY-Www

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalDate(value: string): value is LocalDate {
  if (!DATE_RE.test(value)) return false;
  const [, y, m, d] = DATE_RE.exec(value)!;
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return dd <= daysInMonth;
}

export function isIsoWeek(value: string): value is IsoWeek {
  if (!WEEK_RE.test(value)) return false;
  const [, y, w] = WEEK_RE.exec(value)!;
  const ww = Number(w);
  if (ww < 1 || ww > 53) return false;
  return ww <= weeksInYear(Number(y));
}

export function isHhMm(value: string): boolean {
  return TIME_RE.test(value);
}

/** Parse a local date into a UTC-midnight epoch value for ordering. */
export function dateToUtcEpoch(date: LocalDate): number {
  const [, y, m, d] = DATE_RE.exec(date)!;
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) / 1000;
}

export function utcEpochToDate(epochSeconds: number): LocalDate {
  const dt = new Date(epochSeconds * 1000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return utcEpochToDate(dateToUtcEpoch(date) + days * 86400);
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((dateToUtcEpoch(b) - dateToUtcEpoch(a)) / 86400);
}

/** Day of week, 0 = Monday .. 6 = Sunday, for a local date. */
export function weekdayIndex(date: LocalDate): number {
  const dow = new Date(dateToUtcEpoch(date) * 1000).getUTCDay(); // 0=Sun
  return (dow + 6) % 7;
}

/** The Monday of the ISO week containing `date`. */
export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -weekdayIndex(date));
}

export function isoWeekOf(date: LocalDate): IsoWeek {
  const epoch = dateToUtcEpoch(date);
  const thursday = epoch + (3 - weekdayIndex(date)) * 86400;
  const dt = new Date(thursday * 1000);
  const year = dt.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1) / 1000;
  const week = Math.floor((thursday - jan1) / 86400 / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function weeksInYear(year: number): number {
  const jan1Epoch = Date.UTC(year, 0, 1) / 1000;
  const dec31Epoch = Date.UTC(year, 11, 31) / 1000;
  const p = (epoch: number) => (new Date(epoch * 1000).getUTCDay() + 6) % 7;
  if (p(jan1Epoch) === 0 || p(dec31Epoch) === 6) return 53;
  return 52;
}

export function mondayFromWeek(week: IsoWeek): LocalDate {
  const [, y, w] = WEEK_RE.exec(week)!;
  const year = Number(y);
  const weekNum = Number(w);
  const jan4Epoch = Date.UTC(year, 0, 4) / 1000;
  const jan4Weekday = (new Date(jan4Epoch * 1000).getUTCDay() + 6) % 7;
  const week1Monday = jan4Epoch - jan4Weekday * 86400;
  return utcEpochToDate(week1Monday + (weekNum - 1) * 7 * 86400);
}

export function weekFromMonday(monday: LocalDate): IsoWeek {
  return isoWeekOf(monday);
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return dateToUtcEpoch(a) - dateToUtcEpoch(b);
}

// ---------------------------------------------------------------------------
// Zone conversions
// ---------------------------------------------------------------------------

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const offsetCache = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let f = offsetCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetCache.set(tz, f);
  }
  return f;
}

/** The offset in seconds east of UTC for a given instant in `tz`. */
export function zoneOffsetSeconds(tz: string, epochSeconds: number): number {
  const parts = offsetFormatter(tz).formatToParts(new Date(epochSeconds * 1000));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour) % 24, Number(map.minute), Number(map.second)) / 1000;
  return asUtc - epochSeconds;
}

/** Convert an instant into the zone's local calendar parts. */
export function zonedParts(tz: string, epochSeconds: number): ZonedParts {
  const parts = offsetFormatter(tz).formatToParts(new Date(epochSeconds * 1000));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
  };
}

/**
 * Resolve a local wall-clock time in `tz` to an instant, applying the
 * published gap and overlap rules: a time inside a spring-forward gap moves
 * later by the gap's length; a repeated time uses its first occurrence.
 */
export function wallClockToInstant(tz: string, date: LocalDate, hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const naive = dateToUtcEpoch(date) + h * 3600 + m * 60;
  const guess = naive - zoneOffsetSeconds(tz, naive);
  const after = naive - zoneOffsetSeconds(tz, guess);
  if (after === guess) return guess;
  const earlier = Math.min(guess, after);
  const later = Math.max(guess, after);
  const offEarlier = naive - zoneOffsetSeconds(tz, earlier);
  const offLater = naive - zoneOffsetSeconds(tz, later);
  if (offEarlier === earlier) return earlier;
  if (offLater === later) return later;
  // The local time falls in a gap: move later by the gap length.
  return later;
}

export function instantToWallClock(tz: string, epochSeconds: number): { date: LocalDate; hhmm: string } {
  const p = zonedParts(tz, epochSeconds);
  return {
    date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
    hhmm: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
  };
}

export interface InstantParseResult {
  epochSeconds: number;
  hasOffset: boolean;
}

/** Parse an ISO-8601 date-time with optional offset into an instant. */
export function parseIsoDateTime(value: string): InstantParseResult | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, off] = m;
  let seconds = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0) / 1000;
  const fractional = frac ? Number(`0.${frac}`) : 0;
  if (off && off !== 'Z') {
    const sign = off.startsWith('-') ? -1 : 1;
    const rest = off.slice(1).replace(':', '');
    const oh = Number(rest.slice(0, 2));
    const om = Number(rest.slice(2, 4));
    seconds -= sign * (oh * 3600 + om * 60);
    return { epochSeconds: seconds + fractional, hasOffset: true };
  }
  return { epochSeconds: seconds + fractional, hasOffset: off === 'Z' };
}
