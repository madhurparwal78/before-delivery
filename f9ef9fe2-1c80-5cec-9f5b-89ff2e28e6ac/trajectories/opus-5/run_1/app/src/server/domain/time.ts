/**
 * Kitchen time. Every date, cell time, cutoff, tier bucket, report month and
 * document expiry is judged here, in the kitchen's IANA zone. The device zone
 * never takes part.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timezone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timezone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timezone, created);
  return created;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function partsInZone(timezone: string, instant: Date): ZonedParts {
  const parts = zoneFormatter(timezone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
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

function zoneOffsetMinutes(timezone: string, instant: Date): number {
  const parts = partsInZone(timezone, instant);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return (asUtc - instant.getTime()) / 60000;
}

export function kitchenToday(timezone: string, now: Date): string {
  const parts = partsInZone(timezone, now);
  return formatDate(parts.year, parts.month, parts.day);
}

/** Minutes since kitchen midnight for an instant. */
export function kitchenMinutes(timezone: string, now: Date): number {
  const parts = partsInZone(timezone, now);
  return parts.hour * 60 + parts.minute;
}

/**
 * The instant of a kitchen wall-clock time. A wall-clock time skipped by a
 * spring-forward change moves forward by the length of the skipped hour; a time
 * that happens twice in an autumn change uses its first occurrence.
 */
export function kitchenInstant(timezone: string, date: string, minutes: number): Date {
  const [year, month, day] = splitDate(date);
  const target = Date.UTC(year, month - 1, day) + minutes * 60000;
  const firstOffset = zoneOffsetMinutes(timezone, new Date(target));
  const firstGuess = target - firstOffset * 60000;
  const secondOffset = zoneOffsetMinutes(timezone, new Date(firstGuess));
  if (secondOffset === firstOffset) return new Date(firstGuess);
  const secondGuess = target - secondOffset * 60000;
  if (zoneOffsetMinutes(timezone, new Date(secondGuess)) === secondOffset) {
    return new Date(secondGuess);
  }
  return new Date(firstGuess);
}

function splitDate(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = splitDate(date);
  const moved = new Date(Date.UTC(year, month - 1, day) + days * 86400000);
  return formatDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Whole days from `from` to `to`, both kitchen dates. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = splitDate(from);
  const [ty, tm, td] = splitDate(to);
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function weekdayOf(date: string): number {
  const [year, month, day] = splitDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = splitDate(value);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() + 1 === month && probe.getUTCDate() === day
  );
}

export function isValidMonth(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function monthRange(month: string): { first: string; last: string } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const first = formatDate(year, index, 1);
  const lastDay = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { first, last: formatDate(year, index, lastDay) };
}
