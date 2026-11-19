import { ApiError } from './errors.js';

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** IANA time zone list from the platform when available, otherwise a curated list. */
const FALLBACK_ZONES = [
  'UTC', 'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
  'America/Chicago', 'America/New_York', 'America/Toronto', 'Europe/London', 'Europe/Dublin',
  'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Warsaw', 'Europe/Athens',
  'Europe/Helsinki', 'Europe/Lisbon', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos',
  'Asia/Dubai', 'Asia/Tehran', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Colombo', 'Asia/Kathmandu',
  'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Tokyo',
  'Asia/Seoul', 'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Sydney',
  'Australia/Melbourne', 'Pacific/Auckland', 'Pacific/Fiji', 'America/Sao_Paulo',
  'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago',
  'America/Argentina/Buenos_Aires', 'America/St_Johns', 'Asia/Taipei', 'Asia/Jakarta',
  'Asia/Ho_Chi_Minh', 'Asia/Manila', 'Asia/Kuala_Lumpur', 'Asia/Tashkent', 'Asia/Yekaterinburg',
  'Asia/Tbilisi', 'Europe/Istanbul', 'Europe/Kiev', 'Europe/Minsk', 'Europe/Oslo',
  'Europe/Stockholm', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Vienna',
  'Europe/Prague', 'Europe/Budapest', 'Europe/Bucharest', 'Europe/Copenhagen', 'Atlantic/Azores',
  'Pacific/Chatham',
];

function loadTimeZones(): readonly string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof supported === 'function') return supported('timeZone').sort();
  } catch {
    /* falls through */
  }
  return FALLBACK_ZONES;
}

export const KNOWN_TIME_ZONES: readonly string[] = loadTimeZones();

export function isKnownTimeZone(zone: string): boolean {
  return KNOWN_TIME_ZONES.includes(zone);
}

export function requireTimeZone(zone: unknown, field = 'timeZone'): string {
  const value = typeof zone === 'string' ? zone : '';
  if (!isKnownTimeZone(value)) {
    throw new ApiError('validation', 'Choose a time zone.', { fields: { [field]: 'Choose a known IANA time zone.' } });
  }
  return value;
}

export function cleanTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length < 1 || title.length > 200) {
    throw new ApiError('validation', 'Titles are 1 to 200 characters.', { fields: { title: 'Titles are 1 to 200 characters.' } });
  }
  return title;
}

export function cleanName(value: unknown, field: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 1 || name.length > 80) {
    throw new ApiError('validation', 'Enter between 1 and 80 characters.', { fields: { [field]: 'Enter between 1 and 80 characters.' } });
  }
  return name;
}

export function cleanEstimate(value: unknown, field: string, min: number, max: number, step: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ApiError('validation', 'Enter a whole number of minutes.', { fields: { [field]: 'Enter a whole number of minutes.' } });
  }
  if (value < min || value > max || (value - min) % step !== 0) {
    throw new ApiError('validation', `Enter ${min} to ${max} in steps of ${step}.`, {
      fields: { [field]: `Enter ${min} to ${max} in steps of ${step}.` },
    });
  }
  return value;
}

export function cleanThreshold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 60 || value > 960 || (value - 60) % 15 !== 0) {
    throw new ApiError('validation', 'The workload threshold is 60 to 960 minutes in steps of 15.', {
      fields: { thresholdMinutes: 'Enter 60 to 960 in steps of 15.' },
    });
  }
  return value;
}

export function cleanEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : '';
  if (email.length === 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError('validation', 'Enter a valid email address.', { fields: { email: 'Enter a valid email address.' } });
  }
  return email.toLowerCase();
}

export function cleanPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10) {
    throw new ApiError('validation', 'Passwords are at least 10 characters.', { fields: { password: 'Use at least 10 characters.' } });
  }
  return value;
}

export function cleanDate(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value : '';
  if (!DAY_RE.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) {
    throw new ApiError('validation', `Enter ${field} as a date written YYYY-MM-DD.`, { fields: { [field]: 'Use the format YYYY-MM-DD.' } });
  }
  return s;
}

export function cleanLocalTime(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value : '';
  if (!TIME_RE.test(s)) {
    throw new ApiError('validation', `Enter ${field} as a time written HH:MM.`, { fields: { [field]: 'Use the 24-hour format HH:MM.' } });
  }
  return s;
}

const DAY_MS = 86_400_000;

/** Offset (ms) at an instant: local wall-clock reading minus the instant itself. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(instant));
  const get = (t: string): string => {
    const p = parts.find((x) => x.type === t);
    return p === undefined ? '00' : p.value;
  };
  return Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`) - instant;
}

/** The local wall-clock stamp "YYYY-MM-DDTHH:MM" of an instant in a zone. */
export function wallStamp(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(instant));
  const get = (t: string): string => {
    const p = parts.find((x) => x.type === t);
    return p === undefined ? '00' : p.value;
  };
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** A local calendar date (YYYY-MM-DD) inside a time zone, from an instant. */
export function localDateOf(instant: Date, timeZone: string): string {
  return wallStamp(instant.getTime(), timeZone).slice(0, 10);
}

/** Local wall-clock HH:MM of an instant in a zone. */
export function localTimeOf(instant: Date, timeZone: string): string {
  return wallStamp(instant.getTime(), timeZone).slice(11, 16);
}

/**
 * The single rule for a wall-clock time on a local date.
 * Returns the first instant whose local stamp is that wall clock, or null inside a DST gap.
 */
export function wallClockToInstant(dateStr: string, hhmm: string, timeZone: string): Date | null {
  const target = `${dateStr}T${hhmm}`;
  const naive = Date.parse(`${dateStr}T${hhmm}:00Z`);
  if (Number.isNaN(naive)) return null;
  const offsets = [offsetAt(naive - DAY_MS, timeZone), offsetAt(naive, timeZone), offsetAt(naive + DAY_MS, timeZone)];
  let first: number | null = null;
  for (const off of offsets) {
    const candidate = naive - off;
    if (first !== null && candidate >= first) continue;
    if (wallStamp(candidate, timeZone) === target) first = candidate;
  }
  return first === null ? null : new Date(first);
}

/**
 * The single rule for a routine start on a local date, DST-safe.
 * Gap: start the length of the gap later. Overlap: the first (earlier) instant.
 */
export function routineStartInstant(dateStr: string, hhmm: string, timeZone: string): Date | null {
  const direct = wallClockToInstant(dateStr, hhmm, timeZone);
  if (direct !== null) return direct;
  const naive = Date.parse(`${dateStr}T${hhmm}:00Z`);
  const before = offsetAt(naive - DAY_MS, timeZone);
  const after = offsetAt(naive + DAY_MS, timeZone);
  const gap = after - before;
  if (gap <= 0) return null;
  const start = naive + gap - after;
  // The occurrence begins just past the transition, at the post-transition offset.
  return offsetAt(start, timeZone) === after ? new Date(start) : null;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(Date.parse(dateStr + 'T00:00:00Z'));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(dateStr: string): number {
  return new Date(Date.parse(dateStr + 'T00:00:00Z')).getUTCDay();
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** English weekday, day number and month name: "Thursday 29 October". */
export function dayLabel(dateStr: string, timeZone: string): string {
  const d = new Date(Date.parse(dateStr + 'T12:00:00Z'));
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

/** Three-letter weekday and day number: "Thu 29". */
export function shortDay(dateStr: string): string {
  const d = new Date(Date.parse(dateStr + 'T12:00:00Z'));
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(d);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric' }).format(d);
  return `${weekday} ${day}`;
}

/** The Monday date of the ISO week containing dateStr. */
export function isoWeekMonday(dateStr: string): string {
  const d = new Date(Date.parse(dateStr + 'T00:00:00Z'));
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

export function isoWeekOf(dateStr: string): string {
  const monday = isoWeekMonday(dateStr);
  const thu = new Date(Date.parse(monday + 'T00:00:00Z') + 3 * DAY_MS);
  const year = thu.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1Dow = jan1.getUTCDay() === 0 ? 7 : jan1.getUTCDay();
  const week1Mon = new Date(jan1.getTime() - (jan1Dow - 1) * DAY_MS);
  const week = Math.round((thu.getTime() - week1Mon.getTime()) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The Monday and Sunday of an ISO week "YYYY-Www", or null when malformed. */
export function isoWeekDates(week: string): { monday: string; sunday: string } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (m === null) return null;
  const year = Number(m[1]);
  const w = Number(m[2]);
  if (w < 1 || w > 53) return null;
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1Dow = jan1.getUTCDay() === 0 ? 7 : jan1.getUTCDay();
  const week1Mon = new Date(jan1.getTime() - (jan1Dow - 1) * DAY_MS);
  const monday = new Date(week1Mon.getTime() + (w - 1) * 7 * DAY_MS);
  if (Number(isoWeekMonday(monday.toISOString().slice(0, 10)).slice(0, 4)) !== year) return null;
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  return { monday: monday.toISOString().slice(0, 10), sunday: sunday.toISOString().slice(0, 10) };
}

/** ISO instant with a Z suffix, at second precision. */
export function isoInstant(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Milliseconds from now until the next local midnight in a zone. */
export function msUntilLocalMidnight(now: Date, timeZone: string): number {
  const today = localDateOf(now, timeZone);
  const tomorrow = addDays(today, 1);
  const midnight = wallClockToInstant(tomorrow, '00:00', timeZone);
  if (midnight !== null) return Math.max(0, midnight.getTime() - now.getTime());
  // Midnight itself sits in a gap: the new day starts at the gap exit.
  for (let min = 0; min <= 180; min++) {
    const probe = wallClockToInstant(tomorrow, hhmm(min), timeZone);
    if (probe !== null && probe.getTime() > now.getTime()) return probe.getTime() - now.getTime();
  }
  return 60_000;
}
