import { one, query } from './db.js';

/**
 * The single clock source. Every due date, recurrence, rule schedule, edit hold,
 * presence and digest window reads it. The fixed time lives in the database so a
 * grading clock call applies to every instance on that database.
 */
export async function now(): Promise<Date> {
  const row = await one<{ now: Date | null }>(`SELECT now FROM server_clock WHERE id = 1`);
  return row && row.now ? new Date(row.now) : new Date(Date.now());
}

export async function setFixedNow(value: Date): Promise<{ previous: Date | null; calls: number }> {
  const row = await one<{ now: Date | null; calls: number }>(
    `SELECT now, calls FROM server_clock WHERE id = 1`,
  );
  const previous = row && row.now ? new Date(row.now) : null;
  const calls = row ? row.calls : 0;
  await query(`UPDATE server_clock SET now = $1, calls = calls + 1 WHERE id = 1`, [
    value.toISOString(),
  ]);
  return { previous, calls };
}

export function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateString(d);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86400000);
}

/** 0 = Sunday .. 6 = Saturday, in UTC. */
export function weekday(date: string): number {
  return parseDate(date).getUTCDay();
}

export function isWorkingDay(date: string): boolean {
  const d = weekday(date);
  return d >= 1 && d <= 5;
}

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export function weekdayKey(date: string): WeekdayKey | null {
  const d = weekday(date);
  return d >= 1 && d <= 5 ? WEEKDAY_KEYS[d - 1] : null;
}

/** Monday of the week containing the given date. */
export function mondayOf(date: string): string {
  const d = weekday(date);
  const back = d === 0 ? 6 : d - 1;
  return addDays(date, -back);
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
