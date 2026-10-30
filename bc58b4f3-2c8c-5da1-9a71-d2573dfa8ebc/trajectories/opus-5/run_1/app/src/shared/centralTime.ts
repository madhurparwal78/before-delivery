export const AGENCY_ZONE = 'America/Chicago';

export const DAY_START_MINUTE = 6 * 60;
export const DAY_END_MINUTE = 22 * 60;
export const MINUTES_IN_DAY_WINDOW = DAY_END_MINUTE - DAY_START_MINUTE;

export interface CentralParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: AGENCY_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: AGENCY_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: AGENCY_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const fullDayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: AGENCY_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function lookup(formatter: Intl.DateTimeFormat, date: Date, type: Intl.DateTimeFormatPartTypes): string {
  const part = formatter.formatToParts(date).find((candidate) => candidate.type === type);
  if (part === undefined) throw new Error(`Missing ${type} part`);
  return part.value;
}

export function centralParts(date: Date): CentralParts {
  const parts = partsFormatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) throw new Error(`Missing ${type} part`);
    return Number.parseInt(part.value, 10);
  };
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

export function centralOffsetMinutes(date: Date): number {
  const parts = centralParts(date);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function instantFromCentral(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = naive;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = naive - centralOffsetMinutes(new Date(instant)) * 60000;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

export function centralDateKey(date: Date): string {
  const parts = centralParts(date);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function centralMinuteOfDay(date: Date): number {
  const parts = centralParts(date);
  return parts.hour * 60 + parts.minute;
}

/** `Thu 12 Nov` */
export function formatCentralDay(date: Date): string {
  const parts = dayFormatter.formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  return `${weekday} ${day} ${month}`;
}

/** `09:00` */
export function formatCentralTime(date: Date): string {
  const hour = lookup(timeFormatter, date, 'hour');
  const minute = lookup(timeFormatter, date, 'minute');
  return `${hour === '24' ? '00' : hour}:${minute}`;
}

/** `Thu 12 Nov 09:00` */
export function formatCentralDateTime(date: Date): string {
  return `${formatCentralDay(date)} ${formatCentralTime(date)}`;
}

/** `Thu 12 Nov 09:00–10:30` */
export function formatCentralRange(start: Date, end: Date): string {
  return `${formatCentralDateTime(start)}–${formatCentralTime(end)}`;
}

/** `Mon 9 Nov 2026` */
export function formatCentralFullDay(date: Date): string {
  const parts = fullDayFormatter.formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  return `${weekday} ${day} ${month} ${year}`;
}

/** 1 = Monday … 7 = Sunday, in the agency zone. */
export function centralWeekday(date: Date): number {
  const parts = centralParts(date);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addCentralDays(date: Date, days: number): Date {
  const parts = centralParts(date);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return instantFromCentral(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    parts.hour,
    parts.minute,
  );
}

/** Monday 00:00 in the agency zone of the week holding `date`. */
export function centralWeekStart(date: Date): Date {
  const weekday = centralWeekday(date);
  const parts = centralParts(date);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - (weekday - 1)));
  return instantFromCentral(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
  );
}

export function parseCentralDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10);
  const day = Number.parseInt(match[3] as string, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const instant = instantFromCentral(year, month, day, 0, 0);
  if (centralDateKey(instant) !== value) return null;
  return instant;
}

/** `1:30` */
export function formatHoursMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}
