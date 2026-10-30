// Domain rules shared by the server and the browser. Each rule is decided here once.

import { addDays, wallInstant } from "./zone.js";

export const CELL_MINUTES = 15;
export const BOARD_OPENS = 5 * 60;
export const BOARD_CLOSES = 24 * 60;
export const FREE_CANCEL_DAYS = 2;
export const CHECK_IN_OPENS_MINUTES = 15;
export const BOOKING_DAYS_AHEAD = 28;

const CLOCK_PATTERN = /^(\d{2}):(\d{2})$/;

/** Minutes since midnight for "HH:MM"; "24:00" only when it may be an end. */
export function parseClock(value: unknown, allowMidnightEnd: boolean): number | null {
  if (typeof value !== "string") return null;
  const match = CLOCK_PATTERN.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  if (hours === 24 && minutes === 0 && allowMidnightEnd) return BOARD_CLOSES;
  if (hours > 23) return null;
  return hours * 60 + minutes;
}

export function clock(minuteOfDay: number): string {
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
}

export function onGrid(minuteOfDay: number): boolean {
  return minuteOfDay % CELL_MINUTES === 0;
}

/** The start minute of every 15-minute cell a span covers, from its start to the end of its cleaning tail. */
export function spanCells(start: number, tailEnd: number): number[] {
  const cells: number[] = [];
  for (let cell = start; cell < tailEnd; cell += CELL_MINUTES) cells.push(cell);
  return cells;
}

/** Price of a number of minutes at an hourly rate in cents, rounded half up to the cent. */
export function priceCents(minutes: number, hourlyRateCents: number): number {
  return Math.floor((2 * minutes * hourlyRateCents + 60) / 120);
}

interface CostSplit {
  bookedMinutes: number;
  prepaidMinutes: number;
  overageMinutes: number;
  overageCents: number;
}

/** Prepaid hours first, then overage at the station's hourly rate. The cleaning tail is never charged. */
export function costSplit(bookedMinutes: number, balanceMinutes: number, hourlyRateCents: number): CostSplit {
  const prepaidMinutes = Math.max(0, Math.min(bookedMinutes, balanceMinutes));
  const overageMinutes = bookedMinutes - prepaidMinutes;
  return { bookedMinutes, prepaidMinutes, overageMinutes, overageCents: priceCents(overageMinutes, hourlyRateCents) };
}

/** Half the booking's list price, rounded half up to the cent. */
export function lateFeeCents(listCents: number): number {
  return Math.floor((listCents + 1) / 2);
}

/** Same kitchen wall-clock time two calendar days before the start. */
export function freeCancelUntil(date: string, start: number, timeZone: string): number {
  return wallInstant(addDays(date, -FREE_CANCEL_DAYS), start, timeZone);
}

/** Free up to and including the cutoff instant. */
export function cancellationIsFree(now: number, cutoff: number): boolean {
  return now <= cutoff;
}

/** From 15 minutes before the start (included) to the end (excluded). */
export function inCheckInWindow(now: number, startsAt: number, endsAt: number): boolean {
  return now >= startsAt - CHECK_IN_OPENS_MINUTES * 60_000 && now < endsAt;
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Decimal hours with two decimals, rounded half up: 225 minutes is "3.75". */
export function formatHours(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const hundredths = Math.floor((Math.abs(minutes) * 200 + 60) / 120);
  return `${sign}${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** A duration as h:mm, e.g. "1:30". */
export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
