export type LocalDate = string;
export type IsoWeek = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const DAY_MS = 86_400_000;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function isValidDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function isValidTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = TIME_RE.exec(value);
  if (!match) return false;
  return Number(match[1]) < 24 && Number(match[2]) < 60;
}

export function isValidWeek(value: unknown): value is IsoWeek {
  if (typeof value !== 'string') return false;
  const match = WEEK_RE.exec(value);
  if (!match) return false;
  const week = Number(match[2]);
  return week >= 1 && week <= 53 && week <= weeksInIsoYear(Number(match[1]));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function parts(date: LocalDate): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Not a local date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Days since 1970-01-01 for a local calendar date. */
export function dayNumber(date: LocalDate): number {
  const { year, month, day } = parts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function fromDayNumber(days: number): LocalDate {
  const utc = new Date(days * DAY_MS);
  const year = utc.getUTCFullYear();
  const month = utc.getUTCMonth() + 1;
  const day = utc.getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(date: LocalDate, count: number): LocalDate {
  return fromDayNumber(dayNumber(date) + count);
}

export function diffDays(later: LocalDate, earlier: LocalDate): number {
  return dayNumber(later) - dayNumber(earlier);
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const list: LocalDate[] = [];
  for (let day = dayNumber(from); day <= dayNumber(to); day += 1) list.push(fromDayNumber(day));
  return list;
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  return ((dayNumber(date) + 3) % 7 + 7) % 7 + 1;
}

export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function isoWeekOf(date: LocalDate): IsoWeek {
  const thursday = addDays(mondayOf(date), 3);
  const year = parts(thursday).year;
  const firstThursday = addDays(mondayOf(`${year}-01-04`), 3);
  const week = Math.round(diffDays(thursday, firstThursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function mondayOfWeek(week: IsoWeek): LocalDate {
  const match = WEEK_RE.exec(week);
  if (!match) throw new Error(`Not an ISO week: ${week}`);
  const firstMonday = mondayOf(`${match[1]}-01-04`);
  return addDays(firstMonday, (Number(match[2]) - 1) * 7);
}

function weeksInIsoYear(year: number): number {
  const lastDay = `${year}-12-28`;
  return Number(isoWeekOf(lastDay).slice(6));
}

export function formatDay(date: LocalDate): string {
  const { month, day } = parts(date);
  return `${WEEKDAYS[isoWeekday(date) - 1]} ${day} ${MONTHS[month - 1]}`;
}

export function formatLongDay(date: LocalDate): string {
  const { year } = parts(date);
  return `${formatDay(date)} ${year}`;
}

export function formatMonday(date: LocalDate): string {
  const { year, month, day } = parts(date);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function zoneOffsetMs(instant: number, tz: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const found: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') found[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    found.year ?? 1970,
    (found.month ?? 1) - 1,
    found.day ?? 1,
    found.hour ?? 0,
    found.minute ?? 0,
    found.second ?? 0,
  );
  return asUtc - instant;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function instantToLocal(instant: Date, tz: string): { date: LocalDate; time: string } {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant.getTime(), tz));
  const date = fromDayNumber(Math.floor(shifted.getTime() / DAY_MS));
  const time = `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
  return { date, time };
}

/**
 * Wall-clock local time to an instant. A local time inside a spring-forward gap
 * moves later by the gap, and a repeated local time takes its first occurrence.
 */
export function localToInstant(date: LocalDate, time: string, tz: string): Date {
  const match = TIME_RE.exec(time);
  if (!match) throw new Error(`Not a local time: ${time}`);
  const { year, month, day } = parts(date);
  const naive = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
  const offsets = new Set<number>();
  for (const probe of [naive - DAY_MS, naive, naive + DAY_MS]) offsets.add(zoneOffsetMs(probe, tz));
  const candidates = [...offsets].map((offset) => naive - offset);
  const exact = candidates.filter((candidate) => {
    const local = instantToLocal(new Date(candidate), tz);
    return local.date === date && local.time === time;
  });
  return new Date(exact.length > 0 ? Math.min(...exact) : Math.max(...candidates));
}

const ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Reads an activity file start stamp; a stamp without an offset is athlete-local. */
export function parseActivityStart(value: string, tz: string): Date | null {
  const match = ISO_INSTANT_RE.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, zone] = match;
  if (!isValidDate(`${y}-${mo}-${d}`)) return null;
  if (Number(h) > 23 || Number(mi) > 59) return null;
  if (zone === undefined) {
    const base = localToInstant(`${y}-${mo}-${d}`, `${h}:${mi}`, tz);
    return new Date(base.getTime() + Number(s ?? 0) * 1000);
  }
  let offsetMs = 0;
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offsetMs = sign * (Number(digits.slice(0, 2)) * 3_600_000 + Number(digits.slice(2)) * 60_000);
  }
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)) - offsetMs);
}
