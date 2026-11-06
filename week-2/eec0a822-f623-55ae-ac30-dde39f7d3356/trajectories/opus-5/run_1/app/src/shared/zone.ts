import type { BaseKey } from './format.js';

export const ZONES: Record<BaseKey, string> = {
  split: 'Europe/Zagreb',
  lavrio: 'Europe/Athens',
};

export interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

export function localParts(zone: string, instant: Date): LocalParts {
  const parts = partsFormatter(zone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return Number.parseInt(found === undefined ? '0' : found.value, 10);
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

function zoneOffsetMs(zone: string, instant: Date): number {
  const parts = localParts(zone, instant);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const DAY_MS = 86400000;

/**
 * Instants matching a wall-clock time in a zone: empty inside a spring-forward
 * gap, two entries for a repeated autumn hour, ordered earliest first.
 */
export function localOccurrences(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date[] {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const candidates = new Set<number>();
  for (const probe of [asUtc - DAY_MS, asUtc + DAY_MS]) {
    candidates.add(asUtc - zoneOffsetMs(zone, new Date(probe)));
  }
  const matches: number[] = [];
  for (const candidate of candidates) {
    const parts = localParts(zone, new Date(candidate));
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      matches.push(candidate);
    }
  }
  matches.sort((a, b) => a - b);
  return matches.map((value) => new Date(value));
}

export function startOfLocalDay(zone: string, date: string): Date {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const occurrences = localOccurrences(zone, year, month, day, 0, 0);
  if (occurrences.length > 0) return occurrences[0];
  // A midnight skipped by a forward shift starts the day at the shifted hour.
  for (let minutes = 30; minutes < 24 * 60; minutes += 30) {
    const shifted = localOccurrences(zone, year, month, day, Math.floor(minutes / 60), minutes % 60);
    if (shifted.length > 0) return shifted[0];
  }
  throw new Error(`No local midnight for ${date} in ${zone}`);
}

export function localDate(zone: string, instant: Date): string {
  const parts = localParts(zone, instant);
  return `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function localTime(zone: string, instant: Date): string {
  const parts = localParts(zone, instant);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function pad4(value: number): string {
  return String(value).padStart(4, '0');
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad4(moved.getUTCFullYear())}-${pad2(moved.getUTCMonth() + 1)}-${pad2(moved.getUTCDate())}`;
}

export function weekdayIndex(date: string): number {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isSaturday(date: string): boolean {
  return weekdayIndex(date) === 6;
}


export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const checked = new Date(Date.UTC(year, month - 1, day));
  return (
    checked.getUTCFullYear() === year && checked.getUTCMonth() === month - 1 && checked.getUTCDate() === day
  );
}

export function isValidTimeString(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map((part) => Number.parseInt(part, 10));
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function toInstantString(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

export function splitToday(now: Date): string {
  return localDate(ZONES.split, now);
}
