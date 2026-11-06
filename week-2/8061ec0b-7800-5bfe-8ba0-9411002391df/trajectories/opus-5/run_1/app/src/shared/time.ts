export const STORE_TIME_ZONE = 'America/Chicago';

const MONTH_NAMES = [
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

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: STORE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const abbrevFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: STORE_TIME_ZONE,
  timeZoneName: 'short',
});

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(instant: Date): ZonedParts {
  const found: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

export function zoneOffsetMinutes(instant: Date): number {
  const p = zonedParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}

export function zoneAbbreviation(instant: Date): string {
  for (const part of abbrevFormatter.formatToParts(instant)) {
    if (part.type === 'timeZoneName') return part.value;
  }
  return '';
}

/** The store-zone calendar date of an instant, as YYYY-MM-DD. */
export function storeDateOf(instant: Date): string {
  const p = zonedParts(instant);
  return dateString(p.year, p.month, p.day);
}

/** The instant of a store-zone wall-clock time on a given store date. */
export function storeWallTimeToInstant(date: string, hour: number, minute = 0, second = 0): Date {
  const { year, month, day } = parseDate(date);
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = zoneOffsetMinutes(new Date(naive));
  let instant = naive - offset * 60000;
  offset = zoneOffsetMinutes(new Date(instant));
  instant = naive - offset * 60000;
  return new Date(instant);
}

export function dateString(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

export function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`not a date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseDate(value);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return dateString(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Calendar months forward with the day clamped to the end of the target month. */
export function addMonthsClamped(date: string, months: number): string {
  const { year, month, day } = parseDate(date);
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12 + 1;
  return dateString(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** 0 for Sunday through 6 for Saturday. */
export function weekdayOf(date: string): number {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function formatStoreDate(date: string): string {
  const { year, month, day } = parseDate(date);
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

export function formatStoreDateTime(instant: Date | string): string {
  const at = typeof instant === 'string' ? new Date(instant) : instant;
  const p = zonedParts(at);
  const meridiem = p.hour < 12 ? 'AM' : 'PM';
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const minute = p.minute.toString().padStart(2, '0');
  return `${MONTH_NAMES[p.month - 1]} ${p.day}, ${p.year}, ${hour12}:${minute} ${meridiem} ${zoneAbbreviation(at)}`;
}

/** ISO 8601 UTC to the second, as every timestamp field uses. */
export function isoSeconds(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

/** ISO 8601 UTC to the millisecond, as server_now uses. */
export function isoMillis(instant: Date): string {
  return instant.toISOString();
}
