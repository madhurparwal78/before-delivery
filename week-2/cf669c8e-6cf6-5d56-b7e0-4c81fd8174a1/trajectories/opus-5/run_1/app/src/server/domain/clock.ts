/**
 * The shop clock and Amsterdam business time.
 *
 * Every business time rule — due dates, retries, cutoffs, deadlines, fee dates
 * and seeded slot dates — reads this clock. `HOLD_SECONDS` and
 * `SESSION_SECONDS` always count real seconds and so use `Date.now()`.
 *
 * All zone arithmetic goes through the IANA database via `Intl`, so the true
 * offset on the date concerned is always used.
 */

import { SHOP_TIME_ZONE } from '../../shared/seed.js';

const startedAtRealMs = Date.now();
const shopStartMs = (() => {
  const configured = process.env.SHOP_CLOCK_START;
  if (!configured) return startedAtRealMs;
  const parsed = Date.parse(configured);
  if (Number.isNaN(parsed)) throw new Error(`SHOP_CLOCK_START is not an ISO instant: ${configured}`);
  return parsed;
})();
const shopRate = (() => {
  const configured = process.env.SHOP_CLOCK_RATE;
  if (!configured) return 1;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`SHOP_CLOCK_RATE must be a positive number: ${configured}`);
  }
  return parsed;
})();

/** The shop clock as an instant. */
export function shopNow(): Date {
  const realElapsed = Date.now() - startedAtRealMs;
  return new Date(shopStartMs + Math.round(realElapsed * shopRate));
}

export function shopNowIso(): string {
  return shopNow().toISOString();
}

/** Real seconds, for hold and session lifetimes. */
export function realNow(): Date {
  return new Date();
}

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The Amsterdam wall-clock reading of an instant. */
export function wallTimeAt(instant: Date): WallTime {
  const parts = partsFormatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`missing ${type} in zoned format`);
    return Number(part.value);
  };
  // en-CA renders midnight as hour 24; normalise it to 0.
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

/** The Amsterdam offset at an instant, in minutes east of UTC. */
export function offsetMinutesAt(instant: Date): number {
  const wall = wallTimeAt(instant);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** `YYYY-MM-DD` on the shop clock in Amsterdam. */
export function amsterdamDate(instant: Date = shopNow()): string {
  const wall = wallTimeAt(instant);
  return isoDate(wall.year, wall.month, wall.day);
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** `HH:MM` on the shop clock in Amsterdam. */
export function amsterdamTime(instant: Date = shopNow()): string {
  const wall = wallTimeAt(instant);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}

/**
 * The instant at an Amsterdam wall time, using the true offset on that date.
 *
 * Returns null for a local time that does not exist on the spring clock
 * change. A local time that occurs twice on the autumn change means its first
 * occurrence, which is the earlier instant.
 */
export function instantAtAmsterdamWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date | null {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  const candidates = new Set<number>();
  // Both possible offsets around a transition are within a day of the target.
  for (const probe of [target - 86400000, target, target + 86400000]) {
    const offset = offsetMinutesAt(new Date(probe));
    candidates.add(target - offset * 60000);
  }
  const valid = [...candidates]
    .filter((ms) => {
      const wall = wallTimeAt(new Date(ms));
      return (
        wall.year === year &&
        wall.month === month &&
        wall.day === day &&
        wall.hour === hour &&
        wall.minute === minute &&
        wall.second === second
      );
    })
    .sort((a, b) => a - b);
  const first = valid[0];
  return first === undefined ? null : new Date(first);
}

/** The instant a `YYYY-MM-DD` Amsterdam date begins. */
export function startOfAmsterdamDate(date: string): Date {
  const { year, month, day } = parseIsoDate(date);
  const instant = instantAtAmsterdamWallTime(year, month, day, 0, 0, 0);
  if (!instant) throw new Error(`midnight does not exist on ${date} in ${SHOP_TIME_ZONE}`);
  return instant;
}

export function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`not a YYYY-MM-DD date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseIsoDate(value);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Add days to a `YYYY-MM-DD` date, staying in the calendar. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseIsoDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** 0 is Sunday, 6 is Saturday. */
export function dayOfWeek(date: string): number {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * An ISO instant carrying its Amsterdam offset, e.g.
 * `2026-12-21T23:59:00+01:00`.
 */
export function isoWithAmsterdamOffset(instant: Date): string {
  const wall = wallTimeAt(instant);
  const offset = offsetMinutesAt(instant);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const time = `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}:${String(wall.second).padStart(2, '0')}`;
  return `${isoDate(wall.year, wall.month, wall.day)}T${time}${sign}${hh}:${mm}`;
}

/**
 * Monthly due dates anchored on the confirmation date's day of the month,
 * clamped to the last day of a shorter month.
 */
export function monthlyDueDates(fromDate: string, count: number): string[] {
  const { year, month, day } = parseIsoDate(fromDate);
  return Array.from({ length: count }, (_, i) => {
    const offset = month - 1 + i + 1;
    const targetYear = year + Math.floor(offset / 12);
    const targetMonth = (offset % 12) + 1;
    return isoDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
  });
}

export const HOLD_SECONDS = Number(process.env.HOLD_SECONDS ?? 600);
export const SESSION_SECONDS = Number(process.env.SESSION_SECONDS ?? 43200);
