import { config } from "./config";
import { londonDateOf, londonParts } from "../shared/format";

/** The desk's "now": the server clock, or the frozen instant when DESK_CLOCK_FROZEN_AT is set. */
export const now = (): Date => config.desk.clockFrozenAt ?? new Date();

export const today = (): string => londonDateOf(now());

/** Instants leave the server as ISO 8601 UTC strings ending in Z, whole seconds. */
export const iso = (at: Date): string => at.toISOString().replace(/\.\d{3}Z$/, "Z");

const MINUTE = 60_000;

/** Minutes Europe/London is ahead of UTC at an instant (0 in winter, 60 in summer time). */
function londonOffsetMinutes(utcMs: number): number {
  const p = londonParts(new Date(utcMs));
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((localAsUtc - Math.floor(utcMs / 1000) * 1000) / MINUTE);
}

/**
 * The instant at which Europe/London shows `hour:minute` on a calendar date.
 * In the hour skipped in spring this is the first instant after the gap; in the hour repeated in autumn
 * it is the earlier of the two instants.
 */
export function londonLocalInstant(ymd: string, hour: number, minute: number): Date {
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  for (const offset of [60, 0]) {
    const utc = naive - offset * MINUTE;
    if (londonOffsetMinutes(utc) === offset) return new Date(utc);
  }
  let probe = naive - 60 * MINUTE;
  while (londonOffsetMinutes(probe) !== 60) probe += MINUTE;
  return new Date(probe);
}

export const londonStartOfDay = (ymd: string): Date => londonLocalInstant(ymd, 0, 0);

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

const toYmd = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Purchase date plus calendar months; a day that does not exist becomes the first of the next month. */
export function addCalendarMonths(ymd: string, months: number): string {
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  if (d <= daysInMonth(year, month)) return toYmd(year, month, d);
  return month === 12 ? toYmd(year + 1, 1, 1) : toYmd(year, month + 1, 1);
}

export function addDays(ymd: string, days: number): string {
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return toYmd(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

export function isWeekday(ymd: string): boolean {
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function isValidCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
