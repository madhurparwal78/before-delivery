export const RESTAURANT_TIMEZONE = 'Europe/Lisbon';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: RESTAURANT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: RESTAURANT_TIMEZONE,
  weekday: 'short',
});

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: RESTAURANT_TIMEZONE,
  month: 'short',
});

export interface LisbonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  date: string;
  time: string;
  timeWithSeconds: string;
}

function numericParts(instant: Date): LisbonParts {
  const parts = partsFormatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new Error(`Missing ${type} in formatted date`);
    return Number(found.value);
  };
  const year = read('year');
  const month = read('month');
  const day = read('day');
  const hour = read('hour');
  const minute = read('minute');
  const second = read('second');
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    date: `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
    timeWithSeconds: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
  };
}

export function lisbonParts(instant: Date): LisbonParts {
  return numericParts(instant);
}

export function lisbonOffsetMinutes(instant: Date): number {
  const parts = numericParts(instant);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Turns a Lisbon wall-clock date and time into the instant it names. */
export function lisbonInstant(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = naive;
  for (let round = 0; round < 3; round += 1) {
    const offset = lisbonOffsetMinutes(new Date(guess));
    guess = naive - offset * 60000;
  }
  return new Date(guess);
}

export function lisbonDate(instant: Date): string {
  return numericParts(instant).date;
}

export function lisbonTime(instant: Date): string {
  return numericParts(instant).time;
}

export function addDaysToDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}`;
}

export function daysBetweenDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}

export function isoUtc(instant: Date): string {
  return instant.toISOString();
}

/** ISO 8601 in Lisbon wall-clock time with the Lisbon offset, e.g. 2026-11-14T20:30:00+00:00. */
export function isoWithLisbonOffset(instant: Date): string {
  const parts = numericParts(instant);
  const offset = lisbonOffsetMinutes(instant);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${parts.date}T${parts.timeWithSeconds}${sign}${pad(Math.floor(absolute / 60))}:${pad(
    absolute % 60,
  )}`;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function lisbonWeekday(instant: Date): string {
  const value = weekdayFormatter.format(instant);
  const match = WEEKDAY_NAMES.find((name) => value.startsWith(name));
  return match ?? value;
}

export function lisbonMonth(instant: Date): string {
  return monthFormatter.format(instant);
}

/** `<Ddd> <D> <Mon> at <HH:MM>`, for example `Sat 14 Nov at 20:30`. */
export function formatWhen(instant: Date): string {
  const parts = numericParts(instant);
  return `${lisbonWeekday(instant)} ${parts.day} ${lisbonMonth(instant)} at ${parts.time}`;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60000);
}

export function addSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}
