// The single decision point for the 2026 NYSE regular-session calendar and
// for converting a New York wall date to its session instants.

import { wallTimeToEpochMs, nyDateString } from "./nytime.js";

export interface SessionDay {
  tradingDay: boolean;
  holiday: string | null;
  openAt: number | null; // epoch ms
  closeAt: number | null; // epoch ms
  earlyClose: boolean;
}

const HOLIDAYS_2026: Record<string, string> = {
  "2026-01-01": "New Year's Day",
  "2026-01-19": "Martin Luther King Jr. Day",
  "2026-02-16": "Washington's Birthday",
  "2026-04-03": "Good Friday",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-03": "Independence Day (observed)",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving Day",
  "2026-12-25": "Christmas Day",
};

const EARLY_CLOSES_2026 = new Set(["2026-11-27", "2026-12-24"]);

export const OPEN_HOUR = 9;
export const OPEN_MINUTE = 30;
export const CLOSE_HOUR = 16;
export const CLOSE_MINUTE = 0;
export const EARLY_CLOSE_HOUR = 13;

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function wallMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const t = wallTimeToEpochMs(year, month, day, hour, minute, 0);
  if (t === null) throw new Error(`impossible wall time ${dateKey(year, month, day)}`);
  return t;
}

export function nyWallDateMs(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  return wallMs(year, month, day, 0, 0);
}

/** Session for a date string YYYY-MM-DD. Year must be 2026 (brief covers 2026). */
export function sessionForDate(dateStr: string): SessionDay | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const year = Number(m[1]);
  if (year !== 2026) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const key = dateKey(year, month, day);
  const holiday = HOLIDAYS_2026[key] ?? null;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (holiday || weekday === 0 || weekday === 6) {
    return { tradingDay: false, holiday, openAt: null, closeAt: null, earlyClose: false };
  }
  const earlyClose = EARLY_CLOSES_2026.has(key);
  return {
    tradingDay: true,
    holiday: null,
    openAt: wallMs(year, month, day, OPEN_HOUR, OPEN_MINUTE),
    closeAt: wallMs(year, month, day, earlyClose ? EARLY_CLOSE_HOUR : CLOSE_HOUR, CLOSE_MINUTE),
    earlyClose,
  };
}

export function inRegularSession(nowMs: number): boolean {
  // Never recomputed from epoch arithmetic; reads the calendar for the NY date.
  const dateStr = nyDateString(nowMs);
  const session = sessionForDate(dateStr);
  if (!session || !session.tradingDay) return false;
  const openAt = session.openAt as number;
  const closeAt = session.closeAt as number;
  return nowMs >= openAt && nowMs < closeAt;
}

/** The close instant of the NY trading day that `nowMs` falls in, if it is open. */
export function openSessionCloseAt(nowMs: number): { open: boolean; closeAt: number | null; date: string } {
  const dateStr = nyDateString(nowMs);
  const session = sessionForDate(dateStr);
  if (!session) return { open: false, closeAt: null, date: dateStr };
  if (!session.tradingDay) return { open: false, closeAt: null, date: dateStr };
  const openAt = session.openAt as number;
  const closeAt = session.closeAt as number;
  const open = nowMs >= openAt && nowMs < closeAt;
  return { open, closeAt: open ? closeAt : null, date: dateStr };
}

/** Monday 00:00:00 of the week whose Sunday is `weekEnding`. */
export function weekStartMs(weekEnding: string): number {
  return nyWallDateMs(shiftDate(weekEnding, -6));
}

/** Sunday 23:59:59 of the given week-ending date, at the offset in force then. */
export function weekEndMs(weekEnding: string): number {
  const t = wallTimeToEpochMs(
    Number(weekEnding.slice(0, 4)),
    Number(weekEnding.slice(5, 7)),
    Number(weekEnding.slice(8, 10)),
    23,
    59,
    59,
  );
  if (t === null) throw new Error("impossible week end");
  return t;
}

/** Calendar-date arithmetic in days; no epoch arithmetic, so DST never interferes. */
export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10))));
  d.setUTCDate(d.getUTCDate() + days);
  return dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** The next Sunday after the given Sunday. */
export function nextSunday(weekEnding: string): string {
  return shiftDate(weekEnding, 7);
}
