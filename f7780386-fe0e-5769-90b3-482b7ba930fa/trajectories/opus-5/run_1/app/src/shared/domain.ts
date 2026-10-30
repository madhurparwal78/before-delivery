/**
 * The product's domain rules. Every caller — server routes, sweeps, the CSV
 * export and the browser's live cost tag — decides these questions here and
 * nowhere else.
 */

import { roundHalfUpCents } from './format.js';
import {
  BOARD_CLOSES_MINUTES,
  BOARD_OPENS_MINUTES,
  MINUTES_PER_CELL,
  addDays,
  daysBetween,
  instantAtKitchen,
  isValidDate,
} from './time.js';

export const FREE_CANCEL_DAYS = 2;
export const CHECK_IN_OPENS_MINUTES = 15;
export const BOOKING_DAYS_AHEAD = 28;
export const DEFAULT_HOLD_SECONDS = 600;
export const MAX_UPLOAD_BYTES = 5_000_000;
export const MAX_UPLOAD_REQUEST_BYTES = 5_250_000;
export const MAX_JSON_BYTES = 65_536;
export const PACKET_MAX_RANGE_DAYS = 31;
export const PACKET_MAX_EXPIRY_DAYS = 30;
export const BOOKINGS_MAX_RANGE_DAYS = 62;

export const FIRST_CELL = BOARD_OPENS_MINUTES / MINUTES_PER_CELL;
export const LAST_CELL = BOARD_CLOSES_MINUTES / MINUTES_PER_CELL;

export interface Station {
  id: string;
  name: string;
  hourly_rate_cents: number;
  cleaning_minutes: number;
}

/** Cell indices, counted from kitchen midnight, that a span occupies. */
export function cellsForSpan(startMinutes: number, tailEndMinutes: number): number[] {
  const cells: number[] = [];
  for (let cell = startMinutes / MINUTES_PER_CELL; cell < tailEndMinutes / MINUTES_PER_CELL; cell += 1) {
    cells.push(cell);
  }
  return cells;
}

export function isOnGrid(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes % MINUTES_PER_CELL === 0;
}

export interface CostSplit {
  booked_minutes: number;
  prepaid_minutes: number;
  overage_minutes: number;
  overage_cents: number;
  list_cents: number;
}

/** Prepaid hours are spent first; the remainder is billed at the station rate. */
export function computeCost(
  bookedMinutes: number,
  balanceMinutes: number,
  hourlyRateCents: number,
): CostSplit {
  const prepaid = Math.max(0, Math.min(bookedMinutes, balanceMinutes));
  const overage = bookedMinutes - prepaid;
  return {
    booked_minutes: bookedMinutes,
    prepaid_minutes: prepaid,
    overage_minutes: overage,
    overage_cents: roundHalfUpCents(overage * hourlyRateCents, 60),
    list_cents: roundHalfUpCents(bookedMinutes * hourlyRateCents, 60),
  };
}

/** Half of the booking's list price, rounded half up to the cent. */
export function lateCancellationFeeCents(listCents: number): number {
  return roundHalfUpCents(listCents, 2);
}

export type HoldFieldError = { field: 'station_id' | 'date' | 'start' | 'end'; code: string };

export interface HoldPlacement {
  date: string;
  startMinutes: number;
  endMinutes: number;
  cleaningMinutes: number;
}

/**
 * Placement rules for a hold, in the order the API reports them. Returns the
 * first failure, or null when the span may be held.
 */
export function validateHoldPlacement(
  placement: HoldPlacement,
  now: Date,
  today: string,
  timeZone: string,
): HoldFieldError | null {
  if (!isValidDate(placement.date)) return { field: 'date', code: 'invalid' };
  if (!isOnGrid(placement.startMinutes)) return { field: 'start', code: 'not_on_grid' };
  if (!isOnGrid(placement.endMinutes)) return { field: 'end', code: 'not_on_grid' };
  if (placement.endMinutes <= placement.startMinutes) {
    return { field: 'end', code: 'end_before_start' };
  }
  const tailEnd = placement.endMinutes + placement.cleaningMinutes;
  if (placement.startMinutes < BOARD_OPENS_MINUTES || tailEnd > BOARD_CLOSES_MINUTES) {
    return { field: 'end', code: 'outside_board_hours' };
  }
  if (instantAtKitchen(placement.date, placement.startMinutes, timeZone).getTime() < now.getTime()) {
    return { field: 'start', code: 'in_the_past' };
  }
  if (daysBetween(today, placement.date) > BOOKING_DAYS_AHEAD) {
    return { field: 'date', code: 'too_far_ahead' };
  }
  return null;
}

/**
 * The same kitchen wall-clock time two calendar days before the start. Across a
 * daylight-saving change this is 47 or 49 real hours rather than 48.
 */
export function freeCancelUntil(
  date: string,
  startMinutes: number,
  timeZone: string,
): Date {
  return instantAtKitchen(addDays(date, -FREE_CANCEL_DAYS), startMinutes, timeZone);
}

/**
 * A document covers any booking dated on or before its expiry date, because
 * every booking ends by 24:00 of its own date.
 */
export function documentCoversDate(expiresOn: string, bookingDate: string): boolean {
  return bookingDate <= expiresOn;
}

/** An approved document reads `expired` once the kitchen's today is past it. */
export function documentHasExpired(expiresOn: string, today: string): boolean {
  return today > expiresOn;
}

export interface CheckInWindow {
  opens: Date;
  closes: Date;
}

/** Opens 15 minutes before the start (included) and closes at the end (excluded). */
export function checkInWindow(
  date: string,
  startMinutes: number,
  endMinutes: number,
  timeZone: string,
): CheckInWindow {
  return {
    opens: instantAtKitchen(date, startMinutes - CHECK_IN_OPENS_MINUTES, timeZone),
    closes: instantAtKitchen(date, endMinutes, timeZone),
  };
}

export function isInsideCheckInWindow(window: CheckInWindow, now: Date): boolean {
  return now.getTime() >= window.opens.getTime() && now.getTime() < window.closes.getTime();
}

/** A hold is live strictly before its expiry instant. */
export function isHoldLive(expiresAt: Date, now: Date): boolean {
  return now.getTime() < expiresAt.getTime();
}

/** A packet link is usable while active and strictly before its expiry. */
export function isPacketLinkUsable(status: string, expiresAt: Date, now: Date): boolean {
  return status === 'active' && now.getTime() < expiresAt.getTime();
}

const FORMULA_LEAD = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Spreadsheet formula neutralising, applied to every exported cell. */
export function neutraliseCsvCell(value: string): string {
  const first = value.charAt(0);
  return first !== '' && FORMULA_LEAD.has(first) ? `'${value}` : value;
}

/** RFC 4180 quoting, applied after neutralising. */
export function csvField(value: string): string {
  const neutralised = neutraliseCsvCell(value);
  if (/[",\r\n]/.test(neutralised)) {
    return `"${neutralised.replaceAll('"', '""')}"`;
  }
  return neutralised;
}

export function csvRow(cells: readonly string[]): string {
  return cells.map(csvField).join(',');
}
