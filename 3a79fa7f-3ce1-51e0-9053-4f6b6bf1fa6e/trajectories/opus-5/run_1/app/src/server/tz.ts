/** Timezone and calendar arithmetic, built on Intl so no date library ships. */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timezone, f);
  }
  return f;
}

export function zonedParts(at: Date, timezone: string): ZonedParts {
  const map: Record<string, string> = {};
  for (const p of formatter(timezone).formatToParts(at)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function asUtcMs(p: ZonedParts): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** The offset, in milliseconds, of the zone at this instant. */
function offsetMsAt(at: Date, timezone: string): number {
  return asUtcMs(zonedParts(at, timezone)) - at.getTime();
}

/** Reads a wall-clock local time in a zone and returns its UTC instant. */
export function zonedToUtc(p: ZonedParts, timezone: string): Date {
  const target = asUtcMs(p);
  let guess = target - offsetMsAt(new Date(target), timezone);
  for (let i = 0; i < 3; i += 1) {
    const next = target - offsetMsAt(new Date(guess), timezone);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** The calendar date, YYYY-MM-DD, of an instant read in a zone. */
export function zonedDate(at: Date, timezone: string): string {
  const p = zonedParts(at, timezone);
  return isoDate(p.year, p.month, p.day);
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return { year, month, day };
}

/** Days since the epoch for a calendar date, so dates can be compared and stepped. */
export function dayNumber(value: string): number {
  const { year, month, day } = parseIsoDate(value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

export function dateFromDayNumber(days: number): string {
  const d = new Date(days * 86400000);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(value: string, days: number): string {
  return dateFromDayNumber(dayNumber(value) + days);
}

/** 0 is Sunday. */
export function weekday(value: string): number {
  const { year, month, day } = parseIsoDate(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
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
];

export function monthShort(month: number): string {
  return MONTH_SHORT[month - 1] ?? '';
}

export function weekdayShort(value: string): string {
  return WEEKDAY_SHORT[weekday(value)] ?? '';
}

/** "Thu, Oct 29" */
export function formatShipDate(value: string): string {
  const { month, day } = parseIsoDate(value);
  return `${weekdayShort(value)}, ${monthShort(month)} ${day}`;
}

/** "29 October 2026" in UTC */
export function formatLongDate(at: Date): string {
  return `${at.getUTCDate()} ${MONTH_LONG[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** "29 October 2026, 14:05 UTC" */
export function formatLongDateTime(at: Date): string {
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  return `${formatLongDate(at)}, ${hh}:${mm} UTC`;
}

/** Adds whole calendar months, clamping to the last day of the end month. */
export function addMonths(value: string, months: number): string {
  const { year, month, day } = parseIsoDate(value);
  const total = year * 12 + (month - 1) + months;
  const endYear = Math.floor(total / 12);
  const endMonth = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return isoDate(endYear, endMonth, Math.min(day, lastDay));
}

export function addYearsInstant(at: Date, years: number): Date {
  const d = new Date(at.getTime());
  const day = d.getUTCDate();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d;
}
