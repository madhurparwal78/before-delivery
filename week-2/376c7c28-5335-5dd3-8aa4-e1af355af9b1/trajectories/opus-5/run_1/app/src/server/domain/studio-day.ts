/**
 * Studio-local calendar arithmetic, decided only here.
 *
 * A studio day starts at the studio's local midnight, or at the first instant that exists
 * after it when that local midnight is skipped by a clock change. A local time that occurs
 * twice counts as its first occurrence, which falls out of searching for the first instant.
 */

const DAY_MS = 86_400_000;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dateFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/** The studio-local calendar date of an instant, as `YYYY-MM-DD`. */
export function studioDate(instant: Date, timeZone: string): string {
  const parts = dateFormatter(timeZone).formatToParts(instant);
  let year = '';
  let month = '';
  let day = '';
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
  }
  return `${year}-${month}-${day}`;
}

const dayStartCache = new Map<string, number>();

/** The first instant of a studio-local calendar day. */
export function startOfStudioDay(date: string, timeZone: string): Date {
  const cacheKey = `${timeZone}|${date}`;
  const cached = dayStartCache.get(cacheKey);
  if (cached !== undefined) return new Date(cached);

  const [y, m, d] = date.split('-').map((piece) => Number.parseInt(piece, 10));
  const anchor = Date.UTC(y as number, (m as number) - 1, d as number);
  let lo = anchor - 2 * DAY_MS;
  let hi = anchor + 2 * DAY_MS;
  while (lo + 1 < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (studioDate(new Date(mid), timeZone) >= date) hi = mid;
    else lo = mid;
  }
  dayStartCache.set(cacheKey, hi);
  return new Date(hi);
}

/** The first instant of the studio day after the given one. */
export function startOfNextStudioDay(date: string, timeZone: string): Date {
  return startOfStudioDay(addDays(date, 1), timeZone);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map((piece) => Number.parseInt(piece, 10));
  const shifted = new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + days));
  return isoDate(shifted);
}

/** Whole calendar days from `from` to `to`, both studio-local dates. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map((piece) => Number.parseInt(piece, 10));
  const [ty, tm, td] = to.split('-').map((piece) => Number.parseInt(piece, 10));
  const a = Date.UTC(fy as number, (fm as number) - 1, fd as number);
  const b = Date.UTC(ty as number, (tm as number) - 1, td as number);
  return Math.round((b - a) / DAY_MS);
}

function isoDate(utc: Date): string {
  return `${String(utc.getUTCFullYear()).padStart(4, '0')}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
}

export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

export function firstDateOfMonth(month: string): string {
  return `${month}-01`;
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map((piece) => Number.parseInt(piece, 10));
  const year = (m as number) === 12 ? (y as number) + 1 : (y as number);
  const mon = (m as number) === 12 ? 1 : (m as number) + 1;
  return `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}`;
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map((piece) => Number.parseInt(piece, 10));
  if ((m as number) < 1 || (m as number) > 12 || (d as number) < 1 || (d as number) > 31) return false;
  const probe = new Date(Date.UTC(y as number, (m as number) - 1, d as number));
  return isoDate(probe) === value;
}

export function isMonthString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number.parseInt(value.slice(5), 10);
  return month >= 1 && month <= 12;
}
