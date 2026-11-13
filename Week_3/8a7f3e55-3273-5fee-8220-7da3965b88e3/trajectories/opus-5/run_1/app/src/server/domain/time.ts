import { DateTime } from 'luxon';
import { AGENCY } from './agency.js';

const ZONE = AGENCY.timeZone;
const START_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export type StartResolution =
  | { kind: 'ok'; instant: Date }
  | { kind: 'malformed' }
  | { kind: 'nonexistent' };

function offsetMinutesAt(ms: number): number {
  return DateTime.fromMillis(ms, { zone: ZONE }).offset;
}

function wallAsUtcMillis(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
}

function rendersAs(ms: number, wall: WallClock): boolean {
  const local = DateTime.fromMillis(ms, { zone: ZONE });
  return (
    local.year === wall.year &&
    local.month === wall.month &&
    local.day === wall.day &&
    local.hour === wall.hour &&
    local.minute === wall.minute
  );
}

/**
 * Agency wall-clock time resolves to the single instant that renders as it, to the
 * first of two instants when a fall-back change repeats the time, and to nothing at
 * all when a spring-forward change skips it.
 */
function instantsForWallClock(wall: WallClock): number[] {
  const base = wallAsUtcMillis(wall);
  const dayMs = 86_400_000;
  const offsets = new Set([offsetMinutesAt(base - dayMs), offsetMinutesAt(base + dayMs)]);
  return [...offsets]
    .map((offset) => base - offset * 60_000)
    .filter((ms) => rendersAs(ms, wall))
    .sort((a, b) => a - b);
}

export function parseWallClock(raw: unknown): WallClock | null {
  if (typeof raw !== 'string') return null;
  const match = START_PATTERN.exec(raw);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const wall: WallClock = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
  };
  if (wall.month < 1 || wall.month > 12) return null;
  if (wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59) return null;
  const probe = DateTime.fromObject(
    { year: wall.year, month: wall.month, day: wall.day },
    { zone: ZONE },
  );
  if (!probe.isValid || probe.day !== wall.day) return null;
  return wall;
}

export function resolveAgencyStart(raw: unknown): StartResolution {
  const wall = parseWallClock(raw);
  if (!wall) return { kind: 'malformed' };
  const instants = instantsForWallClock(wall);
  const first = instants[0];
  if (first === undefined) return { kind: 'nonexistent' };
  return { kind: 'ok', instant: new Date(first) };
}

/** The first instant that exists at or after a wall-clock reading in the agency zone. */
export function firstInstantAtOrAfterWallClock(wall: WallClock): Date {
  const instants = instantsForWallClock(wall);
  const first = instants[0];
  if (first !== undefined) return new Date(first);
  const base = wallAsUtcMillis(wall);
  const dayMs = 86_400_000;
  const offsetBefore = offsetMinutesAt(base - dayMs);
  const offsetAfter = offsetMinutesAt(base + dayMs);
  let lo = base - offsetBefore * 60_000;
  let hi = base - offsetAfter * 60_000;
  if (hi < lo) [lo, hi] = [hi, lo];
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (offsetMinutesAt(mid) === offsetAfter) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

export function agencyIso(instant: Date): string {
  return (
    DateTime.fromJSDate(instant, { zone: ZONE })
      .set({ millisecond: 0 })
      .toISO({ suppressMilliseconds: true }) ?? ''
  );
}

export function agencyDate(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: ZONE }).toFormat('yyyy-MM-dd');
}

export function agencyClock(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: ZONE }).toFormat('HH:mm');
}

export function agencyWallClock(instant: Date): WallClock {
  const local = DateTime.fromJSDate(instant, { zone: ZONE });
  return {
    year: local.year,
    month: local.month,
    day: local.day,
    hour: local.hour,
    minute: local.minute,
  };
}

export function parseDateOnly(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = DATE_PATTERN.exec(raw);
  if (!match) return null;
  const parsed = DateTime.fromISO(raw, { zone: ZONE });
  if (!parsed.isValid) return null;
  return parsed.toFormat('yyyy-MM-dd');
}

export function dateOnlyAddDays(dateOnly: string, days: number): string {
  return DateTime.fromISO(dateOnly, { zone: ZONE }).plus({ days }).toFormat('yyyy-MM-dd');
}

export function daysBetweenDateOnly(from: string, to: string): number {
  const a = DateTime.fromISO(from, { zone: ZONE }).startOf('day');
  const b = DateTime.fromISO(to, { zone: ZONE }).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}

export function isMonday(dateOnly: string): boolean {
  return DateTime.fromISO(dateOnly, { zone: ZONE }).weekday === 1;
}

export function mondayOfDate(dateOnly: string): string {
  const day = DateTime.fromISO(dateOnly, { zone: ZONE });
  return day.minus({ days: day.weekday - 1 }).toFormat('yyyy-MM-dd');
}

/** Dates in the agency zone that fall Monday to Friday are business days. */
function isBusinessDay(dateOnly: string): boolean {
  const weekday = DateTime.fromISO(dateOnly, { zone: ZONE }).weekday;
  return weekday >= 1 && weekday <= 5;
}

export function previousBusinessDay(dateOnly: string): string {
  let cursor = dateOnlyAddDays(dateOnly, -1);
  while (!isBusinessDay(cursor)) cursor = dateOnlyAddDays(cursor, -1);
  return cursor;
}
