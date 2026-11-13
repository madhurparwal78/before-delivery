import {
  SEASON_DAY_START_MINUTES,
  SEASON_OFFSET_MINUTES,
  SEASON_SELECTION_EPOCH,
  SEASON_UTC_OFFSET,
} from '../shared/constants.js';

const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;

const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** Parses an offset-bearing ISO instant into epoch milliseconds, or null when invalid. */
export function parseInstant(text: string): number | null {
  const match = INSTANT_PATTERN.exec(text);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d);
  const probe = new Date(utc);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMins = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMins > 59) return null;
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }
  const millis = fraction === undefined ? 0 : Number(fraction.slice(1).padEnd(3, '0'));
  return utc + (h * 60 + mi - offsetMinutes) * MS_PER_MINUTE + s * 1000 + millis;
}

export function normalizeInstant(epochMillis: number): string {
  return new Date(epochMillis).toISOString();
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function localParts(epochMillis: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millis: number;
} {
  const shifted = new Date(epochMillis + SEASON_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millis: shifted.getUTCMilliseconds(),
  };
}

export function localTimeOf(epochMillis: number): string {
  const p = localParts(epochMillis);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}T${pad(p.hour, 2)}:${pad(p.minute, 2)}:${pad(p.second, 2)}.${pad(p.millis, 3)}${SEASON_UTC_OFFSET}`;
}

/** The season day whose local interval contains this instant. */
export function seasonDayOf(epochMillis: number): string {
  const p = localParts(epochMillis);
  const minuteOfDay = p.hour * 60 + p.minute;
  let date = Date.UTC(p.year, p.month - 1, p.day);
  if (minuteOfDay < SEASON_DAY_START_MINUTES) date -= MS_PER_DAY;
  const start = new Date(date);
  return `${pad(start.getUTCFullYear(), 4)}-${pad(start.getUTCMonth() + 1, 2)}-${pad(start.getUTCDate(), 2)}`;
}

export function daysSinceSelectionEpoch(seasonDay: string): number {
  const [year, month, day] = seasonDay.split('-').map(Number);
  const [ey, em, ed] = SEASON_SELECTION_EPOCH.split('-').map(Number);
  return (Date.UTC(year, month - 1, day) - Date.UTC(ey, em - 1, ed)) / MS_PER_DAY;
}

export function previousSeasonDay(seasonDay: string): string {
  const [year, month, day] = seasonDay.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day) - MS_PER_DAY);
  return `${pad(previous.getUTCFullYear(), 4)}-${pad(previous.getUTCMonth() + 1, 2)}-${pad(previous.getUTCDate(), 2)}`;
}

/** Selects the frozen daily digest for a season day from the published digest list. */
export function selectDailyDigest(seasonDay: string, publishedDigests: string[]): string | null {
  if (publishedDigests.length === 0) return null;
  const sorted = [...publishedDigests].sort();
  const days = daysSinceSelectionEpoch(seasonDay);
  return sorted[((days % sorted.length) + sorted.length) % sorted.length];
}
