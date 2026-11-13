import type { WeekDay } from './types.js';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekDay: WeekDay;
}

export const WEEK_DAYS: readonly WeekDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  formatters.set(timeZone, created);
  return created;
}

const weekDayByLabel: Record<string, WeekDay> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
};

/** Reads an instant as wall-clock parts in an IANA zone. */
export function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new Error(`Missing ${type} for zone ${timeZone}`);
    return found.value;
  };
  const weekDay = weekDayByLabel[pick('weekday')];
  if (!weekDay) throw new Error(`Unknown weekday for zone ${timeZone}`);
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour: Number(pick('hour')),
    minute: Number(pick('minute')),
    weekDay,
  };
}

function offsetAt(utcMillis: number, timeZone: string): number {
  const parts = partsInZone(new Date(utcMillis), timeZone);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asIfUtc - Math.floor(utcMillis / 60_000) * 60_000;
}

/**
 * Turns a wall-clock time in an IANA zone into an instant.
 *
 * Clock changes follow one rule: a local time lost to a forward change moves forward by the
 * length of the gap, and a local time that happens twice uses the earlier occurrence.
 */
export function instantFromZonedLocal(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const dayMillis = 86_400_000;
  // Probing a day either side straddles any transition, so both sides of an overlap appear.
  const offsetBefore = offsetAt(naive - dayMillis, timeZone);
  const offsetAfter = offsetAt(naive + dayMillis, timeZone);

  const matches = (candidate: number): boolean => {
    const parts = partsInZone(new Date(candidate), timeZone);
    return (
      parts.year === local.year &&
      parts.month === local.month &&
      parts.day === local.day &&
      parts.hour === local.hour &&
      parts.minute === local.minute
    );
  };

  const valid = [naive - offsetBefore, naive - offsetAfter].filter(matches);
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(naive - Math.min(offsetBefore, offsetAfter));
}

/** Minutes since local midnight, plus the local week day, for a window judgement. */
export function localDayMinutes(instant: Date, timeZone: string): { weekDay: WeekDay; minutes: number } {
  const parts = partsInZone(instant, timeZone);
  return { weekDay: parts.weekDay, minutes: parts.hour * 60 + parts.minute };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** `YYYY-MM-DD HH:mm` in the given zone. */
export function localStamp(instant: Date, timeZone: string): string {
  const parts = partsInZone(instant, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)} ${pad(parts.hour, 2)}:${pad(parts.minute, 2)}`;
}

/** The cluster time format used everywhere on screen: `YYYY-MM-DD HH:mm <zone>`. */
export function clusterTime(instant: Date | string, timeZone: string): string {
  const value = typeof instant === 'string' ? new Date(instant) : instant;
  return `${localStamp(value, timeZone)} ${timeZone}`;
}

export function minutesFromHhMm(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  if (hours > 24) return null;
  const total = hours * 60 + minutes;
  if (total > 1440) return null;
  return total;
}

export function hhMmFromMinutes(total: number): string {
  return `${pad(Math.floor(total / 60), 2)}:${pad(total % 60, 2)}`;
}

/** Parses the `YYYY-MM-DD HH:mm` form people type on the Windows screen. */
export function parseLocalStamp(
  value: string,
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const parsed = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
  if (parsed.month < 1 || parsed.month > 12) return null;
  if (parsed.day < 1 || parsed.day > 31) return null;
  if (parsed.hour > 23 || parsed.minute > 59) return null;
  return parsed;
}

export function addLocalDays(
  local: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}
