const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
const abbrevFormatters = new Map<string, Intl.DateTimeFormat>();

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsFormatter(zone: string): Intl.DateTimeFormat {
  const cached = partsFormatters.get(zone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  partsFormatters.set(zone, formatter);
  return formatter;
}

function abbrevFormatter(zone: string): Intl.DateTimeFormat {
  const cached = abbrevFormatters.get(zone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
  abbrevFormatters.set(zone, formatter);
  return formatter;
}

export function localPartsAt(zone: string, instant: Date): LocalParts {
  const parts = partsFormatter(zone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new Error(`missing ${type} for zone ${zone}`);
    return Number(found.value);
  };
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
  };
}

/** Minutes east of UTC that `zone` is using at `instant`. */
export function offsetMinutesAt(zone: string, instant: Date): number {
  const parts = localPartsAt(zone, instant);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const wholeMinutes = Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS;
  return Math.round((asUtc - wholeMinutes) / MINUTE_MS);
}

export function zoneAbbrev(zone: string, instant: Date): string {
  const part = abbrevFormatter(zone)
    .formatToParts(instant)
    .find((entry) => entry.type === 'timeZoneName');
  if (!part) throw new Error(`missing zone abbreviation for ${zone}`);
  return part.value;
}

/**
 * The one clock-change rule: a local wall-clock time becomes an instant.
 * Times inside a spring gap move forward by the length of the gap; times that
 * happen twice in autumn mean the first, earlier occurrence.
 */
export function resolveLocal(zone: string, date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const earlierOffset = offsetMinutesAt(zone, new Date(asUtc - DAY_MS));
  const laterOffset = offsetMinutesAt(zone, new Date(asUtc + DAY_MS));
  const candidates = [asUtc - earlierOffset * MINUTE_MS, asUtc - laterOffset * MINUTE_MS];
  const valid = candidates.filter((candidate, index) => {
    const used = index === 0 ? earlierOffset : laterOffset;
    return offsetMinutesAt(zone, new Date(candidate)) === used;
  });
  if (valid.length === 0) return new Date(candidates[0] as number);
  return new Date(Math.min(...valid));
}

export function startOfLocalDay(zone: string, date: string): Date {
  return resolveLocal(zone, date, '00:00');
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatUtcDate(shifted);
}

function formatUtcDate(instant: Date): string {
  return `${String(instant.getUTCFullYear()).padStart(4, '0')}-${String(instant.getUTCMonth() + 1).padStart(2, '0')}-${String(instant.getUTCDate()).padStart(2, '0')}`;
}

export function localDate(zone: string, instant: Date): string {
  const parts = localPartsAt(zone, instant);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function localTime(zone: string, instant: Date): string {
  const parts = localPartsAt(zone, instant);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function localStamp(zone: string, instant: Date): string {
  return `${localDate(zone, instant)} ${localTime(zone, instant)} ${zoneAbbrev(zone, instant)}`;
}

/** 1380, 1440 or 1500 minutes. */
export function localDayMinutes(zone: string, date: string): number {
  const start = startOfLocalDay(zone, date);
  const end = startOfLocalDay(zone, addDays(date, 1));
  return Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
}

export interface DayTick {
  at: string;
  label: string;
  zone: string;
}

/** One tick per local hour that exists on that local day. */
export function dayTicks(zone: string, date: string): DayTick[] {
  const start = startOfLocalDay(zone, date).getTime();
  const end = startOfLocalDay(zone, addDays(date, 1)).getTime();
  const ticks: DayTick[] = [];
  for (let at = start; at < end; at += 3_600_000) {
    const instant = new Date(at);
    ticks.push({ at: instant.toISOString(), label: localTime(zone, instant), zone: zoneAbbrev(zone, instant) });
  }
  return ticks;
}

export function elapsedMinutes(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MINUTE_MS);
}

export function datesTouched(zone: string, start: Date, end: Date): string[] {
  const dates: string[] = [];
  let cursor = localDate(zone, start);
  const last = localDate(zone, new Date(end.getTime() - 1));
  dates.push(cursor);
  while (cursor < last) {
    cursor = addDays(cursor, 1);
    dates.push(cursor);
  }
  return dates;
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

export function isTimeString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number) as [number, number];
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
