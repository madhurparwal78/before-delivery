/**
 * Every provider-time question is answered here: the close instant of a cohort, the
 * date a certificate was sealed on, "today" for an effective date, and the month a
 * certificate belongs to.
 */

let providerTimeZone = 'America/Chicago';

export function setProviderTimeZone(timeZone: string): void {
  providerTimeZone = timeZone;
}

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, made);
  return made;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (found === undefined) throw new Error(`Time zone ${timeZone} gave no ${type}`);
    return Number.parseInt(found.value, 10);
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

function offsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const flooredToSecond = Math.floor(instant.getTime() / 1000) * 1000;
  return asIfUtc - flooredToSecond;
}

/** The UTC instant of a wall-clock time in the provider's zone, honouring that date's DST rules. */
export function zonedToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const firstGuess = naive - offsetMs(new Date(naive), providerTimeZone);
  const secondOffset = offsetMs(new Date(firstGuess), providerTimeZone);
  return new Date(naive - secondOffset);
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateOnly(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const match = DATE_PATTERN.exec(value);
  if (match === null) return null;
  const [, yearText, monthText, dayText] = match;
  if (yearText === undefined || monthText === undefined || dayText === undefined) return null;
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** 23:59:59.999 on `date` in the provider's zone, as a UTC instant. */
export function endOfProviderDay(date: string): Date {
  const parts = parseDateOnly(date);
  if (parts === null) throw new Error(`Not a calendar date: ${date}`);
  return zonedToInstant(parts.year, parts.month, parts.day, 23, 59, 59, 999);
}

export function providerDate(instant: Date): string {
  const parts = zonedParts(instant, providerTimeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function providerToday(now: Date = new Date()): string {
  return providerDate(now);
}

/** Whole days from `from` to `to`, counting both ends. */
export function inclusiveDaySpan(from: string, to: string): number {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (start === null || end === null) throw new Error('Not a calendar date');
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  return (endMs - startMs) / 86400000 + 1;
}

/** Twelve calendar months after `instant`, read in the provider's zone. */
export function plusCalendarMonths(instant: Date, months: number): Date {
  const parts = zonedParts(instant, providerTimeZone);
  const totalMonths = parts.month - 1 + months;
  const year = parts.year + Math.floor(totalMonths / 12);
  const month = (totalMonths % 12 + 12) % 12 + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(parts.day, daysInMonth);
  const millisecond = instant.getTime() - Math.floor(instant.getTime() / 1000) * 1000;
  return zonedToInstant(year, month, day, parts.hour, parts.minute, parts.second, millisecond);
}

export function instantToIso(instant: Date): string {
  return instant.toISOString().replace(/\.(\d{3})\d*Z$/, '.$1Z');
}
