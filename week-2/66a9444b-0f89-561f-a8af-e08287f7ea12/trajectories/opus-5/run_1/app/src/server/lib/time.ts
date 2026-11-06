export const TIME_ZONE = 'Europe/Brussels';

/** Offsets Brussels uses, largest (summer) first so ambiguous wall times resolve to their first occurrence. */
const BRUSSELS_OFFSETS_MINUTES = [120, 60];

const offsetFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  timeZoneName: 'longOffset',
});

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export function offsetMinutesAt(instant: Date): number {
  const name = offsetFormatter
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (name === undefined || name === 'GMT') return 0;
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (match === null) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'));
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function wallClockAt(instant: Date): WallClock {
  const parts = partsFormatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

const LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/;

export type LocalTimeFailure = 'invalid' | 'nonexistent_local_time' | 'offset_mismatch';

export interface LocalTimeResult {
  instant: Date;
  offsetMinutes: number;
}

/**
 * Resolves a Brussels wall time to an instant. A time without an explicit offset that falls in the
 * repeated hour of the autumn change means its first (summer-time) occurrence.
 */
export function resolveLocalTime(text: string): LocalTimeResult | LocalTimeFailure {
  const match = LOCAL_PATTERN.exec(text.trim());
  if (match === null) return 'invalid';
  const [, year, month, day, hour, minute, second, offsetText] = match;
  const naive = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? '0'),
  );
  const roundTrips = BRUSSELS_OFFSETS_MINUTES.filter((candidate) => {
    const instant = new Date(naive - candidate * 60_000);
    return offsetMinutesAt(instant) === candidate;
  });

  if (offsetText !== undefined) {
    const explicit = offsetText === 'Z' ? 0 : parseOffset(offsetText);
    if (explicit === null) return 'invalid';
    if (!roundTrips.includes(explicit)) return 'offset_mismatch';
    return { instant: new Date(naive - explicit * 60_000), offsetMinutes: explicit };
  }

  const chosen = roundTrips[0];
  if (chosen === undefined) return 'nonexistent_local_time';
  return { instant: new Date(naive - chosen * 60_000), offsetMinutes: chosen };
}

function parseOffset(text: string): number | null {
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(text);
  if (match === null) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** The same instant written as Brussels wall time with its offset, e.g. 2027-10-31T02:15:00+02:00. */
export function toLocalIso(instant: Date): string {
  const wall = wallClockAt(instant);
  const offset = offsetMinutesAt(instant);
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hour)}:${pad2(
    wall.minute,
  )}:${pad2(wall.second)}${formatOffset(offset)}`;
}

export function toUtcIso(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

/** Festival days run 05:00 to 05:00 Brussels time, so they last 23, 24 or 25 hours. */
export const FESTIVAL_DAY_START_HOUR = 5;

export function festivalDayOf(instant: Date): string {
  const wall = wallClockAt(instant);
  if (wall.hour >= FESTIVAL_DAY_START_HOUR) {
    return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
  }
  return shiftDate(`${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`, -1);
}

export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function festivalDayStart(date: string): Date {
  const resolved = resolveLocalTime(`${date}T${pad2(FESTIVAL_DAY_START_HOUR)}:00`);
  if (typeof resolved === 'string') throw new Error(`invalid festival day ${date}`);
  return resolved.instant;
}

export function festivalDayEnd(date: string): Date {
  return festivalDayStart(shiftDate(date, 1));
}

export function festivalDayLengthHours(date: string): number {
  return (festivalDayEnd(date).getTime() - festivalDayStart(date).getTime()) / 3_600_000;
}

export function festivalDayLabel(date: string): string {
  const parts = weekdayFormatter.formatToParts(festivalDayStart(date));
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  return `${weekday} ${day} ${month}`;
}

export function datesBetween(first: string, last: string): string[] {
  const days: string[] = [];
  let cursor = first;
  while (cursor <= last) {
    days.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return days;
}

export function addSeconds(instant: Date, secondsToAdd: number): Date {
  return new Date(instant.getTime() + secondsToAdd * 1000);
}

export function isDateOnly(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
}
