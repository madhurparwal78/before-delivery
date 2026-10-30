import {
  CELL_MINUTES,
  BOARD_OPENS_MINUTES,
  BOARD_CLOSES_MINUTES,
  FREE_CANCEL_DAYS,
  CSV_NEUTRALISE_PREFIX,
  CSV_NEUTRALISE_FIRST_CHARS,
} from './constants.js';
import type { CostSplit, Station } from './types.js';

// ---------------------------------------------------------------------------
// Money: US dollars, two decimals, half-up to the cent.
// ---------------------------------------------------------------------------

export function moneyFromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const rounded = Math.round(abs); // cents are already integral
  const text = (rounded / 100).toFixed(2);
  return negative && rounded !== 0 ? '-' + text : text;
}

export function centsFromRateTime(hourlyRateCents: number, minutes: number): number {
  // minutes/60 * rate, rounded half up to the cent.
  const product = minutes * hourlyRateCents; // cents * minutes
  const hourCents = product / 60;
  const rounded = Math.sign(hourCents) * Math.round(Math.abs(hourCents) + 1e-9);
  return rounded;
}

export function parseDollars(amount: string): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new Error(`bad amount: ${amount}`);
  return Math.round(value * 100);
}

// ---------------------------------------------------------------------------
// Clock times on the board, kitchen-local "HH:MM". "24:00" only as an end.
// ---------------------------------------------------------------------------

export function minutesFromClock(time: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) throw new Error(`bad time: ${time}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return BOARD_CLOSES_MINUTES;
  if (h > 23 || min > 59) throw new Error(`bad time: ${time}`);
  return h * 60 + min;
}

export function clockFromMinutes(minutes: number): string {
  if (minutes === BOARD_CLOSES_MINUTES) return '24:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isOnGrid(minutes: number): boolean {
  return minutes % CELL_MINUTES === 0;
}

// ---------------------------------------------------------------------------
// The cost split: prepaid hours first, then overage at the station's rate.
// This one function decides every cost figure in the product.
// ---------------------------------------------------------------------------

export function costSplit(balanceMinutes: number, startMinutes: number, endMinutes: number, station: Station): CostSplit {
  const booked = endMinutes - startMinutes;
  const prepaid = Math.min(booked, Math.max(0, balanceMinutes));
  const overage = booked - prepaid;
  const rateCents = parseDollars(station.hourly_rate);
  const overageAmount = centsFromRateTime(rateCents, overage);
  return {
    booked_minutes: booked,
    prepaid_minutes: prepaid,
    overage_minutes: overage,
    overage_amount: moneyFromCents(overageAmount),
  };
}

export function listAmountCents(station: Station, bookedMinutes: number): number {
  return centsFromRateTime(parseDollars(station.hourly_rate), bookedMinutes);
}

export function lateCancellationFeeCents(station: Station, bookedMinutes: number): number {
  // Half the list price, rounded half up to the cent.
  const list = listAmountCents(station, bookedMinutes);
  return Math.sign(list) * Math.round(Math.abs(list) / 2 + 1e-9);
}

// ---------------------------------------------------------------------------
// Collision rule: at most one live hold or non-cancelled booking may cover a
// station's 15-minute cell, counting each one's cleaning tail.
// ---------------------------------------------------------------------------

export interface Span {
  startMinutes: number;
  tailEndMinutes: number;
}

export function spansOverlap(a: Span, b: Span): boolean {
  return a.startMinutes < b.tailEndMinutes && b.startMinutes < a.tailEndMinutes;
}

export function spanFitsBoard(span: Span): boolean {
  // The span with its tail must lie within 05:00 to 24:00 of one kitchen date.
  return (
    span.startMinutes >= BOARD_OPENS_MINUTES &&
    span.tailEndMinutes <= BOARD_CLOSES_MINUTES &&
    isOnGrid(span.startMinutes) &&
    isOnGrid(span.tailEndMinutes)
  );
}

export function holdSpanFitsBoard(startMinutes: number, endMinutes: number, tailMinutes: number): boolean {
  return (
    startMinutes >= BOARD_OPENS_MINUTES &&
    endMinutes > startMinutes &&
    isOnGrid(startMinutes) &&
    isOnGrid(endMinutes) &&
    endMinutes + tailMinutes <= BOARD_CLOSES_MINUTES
  );
}

// ---------------------------------------------------------------------------
// Cancellation cutoff: the same kitchen wall-clock time two calendar days
// before the booking's start, in the kitchen's zone.
// ---------------------------------------------------------------------------

export function freeCancelCutoffDate(bookingDate: string): string {
  const [y, m, d] = bookingDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - FREE_CANCEL_DAYS);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Document coverage: valid through the end of its expires_on date, kitchen
// time. A booking dated on or before expires_on is covered.
// ---------------------------------------------------------------------------

export function documentCoversDate(expiresOn: string, date: string): boolean {
  return date <= expiresOn;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// ---------------------------------------------------------------------------
// CSV neutralising: any cell whose first character is = + - @, a tab or a
// carriage return is written with a single apostrophe in front.
// ---------------------------------------------------------------------------

export function neutraliseCell(value: string): string {
  const first = value.charAt(0);
  if (CSV_NEUTRALISE_FIRST_CHARS.includes(first)) {
    return CSV_NEUTRALISE_PREFIX + value;
  }
  return value;
}

export function csvField(value: string): string {
  const neutral = neutraliseCell(value);
  if (/[",\r\n]/.test(neutral)) {
    return '"' + neutral.replace(/"/g, '""') + '"';
  }
  return neutral;
}

// ---------------------------------------------------------------------------
// Formatting shared with the browser's visible copy.
// ---------------------------------------------------------------------------

export function hoursText(minutes: number): string {
  return (Math.abs(minutes) / 60).toFixed(2);
}

export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function dollarsText(amount: string): string {
  return '$' + amount;
}
