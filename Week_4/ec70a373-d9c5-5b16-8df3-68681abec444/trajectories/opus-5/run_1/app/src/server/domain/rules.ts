import {
  SANITATION_BUFFER_MINUTES,
  BOOKING_STEP_MINUTES,
  type BookingStatus,
  type LinkState,
  type RateState,
  type StationKind,
} from '../../shared/types';
import { addDays, daysBetween, localDateOf, localParts, localToInstant } from '../../shared/tz';

/** The sanitation buffer for a station kind, in whole minutes. */
export function sanitationBufferMinutes(kind: StationKind): number {
  return SANITATION_BUFFER_MINUTES[kind];
}

export const BOOKING_HORIZON_DAYS = 90;
export const CUTOFF_MINUTES = 18 * 60;
export const HOLD_LIMIT = 3;
export const CHECK_IN_OPENS_MINUTES = 15;
export const NO_SHOW_OPENS_MINUTES = 30;
export const RETURN_INTERVAL_MS = 24 * 3600 * 1000;

/** A window lies on one site-local date, on booking steps, and ends by 24:00. */
export function isWindowShape(startMinutes: number, endMinutes: number): boolean {
  return (
    Number.isInteger(startMinutes) &&
    Number.isInteger(endMinutes) &&
    startMinutes % BOOKING_STEP_MINUTES === 0 &&
    endMinutes % BOOKING_STEP_MINUTES === 0 &&
    startMinutes >= 0 &&
    startMinutes < endMinutes &&
    endMinutes <= 24 * 60
  );
}

export type CutoffVerdict = 'ok' | 'cutoff' | 'beyond_horizon';

/** The next-day cutoff, judged on the site's own clock. */
export function cutoffVerdict(zone: string, nowMs: number, date: string): CutoffVerdict {
  const today = localDateOf(zone, nowMs);
  if (date <= today) return 'cutoff';
  if (daysBetween(today, date) > BOOKING_HORIZON_DAYS) return 'beyond_horizon';
  if (date === addDays(today, 1)) {
    const parts = localParts(zone, nowMs);
    if (parts.hour * 60 + parts.minute >= CUTOFF_MINUTES) return 'cutoff';
  }
  return 'ok';
}

/** A certificate is valid through 23:59:59 on its valid-through date, in the site's zone. */
export function certificateValidNow(
  validThrough: string | null,
  zone: string,
  nowMs: number,
): boolean {
  if (validThrough === null) return false;
  return nowMs < localToInstant(zone, addDays(validThrough, 1), 0);
}

export function certificateCovers(
  validThrough: string | null,
  zone: string,
  nowMs: number,
  date: string,
): boolean {
  if (!certificateValidNow(validThrough, zone, nowMs)) return false;
  return (validThrough as string) >= date;
}

export interface ForfeitSplit {
  refundedQuarters: number;
  forfeitedQuarters: number;
}

/** The forfeit window, judged on the elapsed notice when the cancellation commits. */
export function forfeitSplit(
  quarters: number,
  startAtMs: number,
  commitMs: number,
): ForfeitSplit {
  const noticeMs = startAtMs - commitMs;
  const hours72 = 72 * 3600 * 1000;
  const hours48 = 48 * 3600 * 1000;
  if (noticeMs >= hours72) return { refundedQuarters: quarters, forfeitedQuarters: 0 };
  if (noticeMs >= hours48) {
    const forfeited = Math.ceil(quarters / 2);
    return { refundedQuarters: quarters - forfeited, forfeitedQuarters: forfeited };
  }
  return { refundedQuarters: 0, forfeitedQuarters: quarters };
}

/** Whole minutes past the booked end, with seconds dropped; never below zero. */
export function latenessMinutes(endAtMs: number, commitMs: number): number {
  const minutes = Math.floor((commitMs - endAtMs) / 60000);
  return minutes > 0 ? minutes : 0;
}

export function lateQuarterHours(endAtMs: number, commitMs: number): number {
  const minutes = latenessMinutes(endAtMs, commitMs);
  return minutes === 0 ? 0 : Math.ceil(minutes / 15);
}

function roundHalfUpDiv(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Tax rates are strings with up to three decimals; this is the rate in milli-percent. */
export function taxMilliPercent(taxRatePercent: string): number {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(taxRatePercent);
  if (match === null) return 0;
  const whole = Number.parseInt(match[1] as string, 10);
  const fraction = ((match[2] ?? '') + '000').slice(0, 3);
  return whole * 1000 + Number.parseInt(fraction, 10);
}

export interface OverageAmount {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/** Overage money: the subtotal and the tax are each rounded half up, once. */
export function overageAmount(
  quarterHours: number,
  hourlyRateCents: number,
  taxRatePercent: string,
): OverageAmount {
  const numerator = quarterHours * hourlyRateCents;
  const subtotalCents = roundHalfUpDiv(numerator, 4);
  const taxCents = roundHalfUpDiv(numerator * taxMilliPercent(taxRatePercent), 400000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export interface RateRow {
  id: string;
  effective_from: string;
  hourly_rate_cents: number;
  tax_rate_percent: string;
  created_at: string;
}

/** The rate whose effective date is the latest on or before a site-local date. */
export function resolveRate<Row extends { effective_from: string }>(
  rates: readonly Row[],
  siteLocalDate: string,
): Row | null {
  let chosen: Row | null = null;
  for (const rate of rates) {
    if (rate.effective_from <= siteLocalDate) {
      if (chosen === null || rate.effective_from > chosen.effective_from) chosen = rate;
    }
  }
  return chosen;
}

export function rateState<Row extends { effective_from: string }>(
  rates: readonly Row[],
  rate: Row,
  siteLocalDate: string,
): RateState {
  const current = resolveRate(rates, siteLocalDate);
  if (rate.effective_from > siteLocalDate) return 'upcoming';
  if (current !== null && current.effective_from === rate.effective_from) return 'current';
  return 'past';
}

/** A visit gap, in hours, rounded half up to two decimals. */
export function gapHours(previousDepartedAtMs: number, departedAtMs: number): number {
  const hours = (departedAtMs - previousDepartedAtMs) / 3600000;
  return Math.floor(hours * 100 + 0.5) / 100;
}

export function gapFlagged(gap: number): boolean {
  return gap > 24;
}

/** Strictly more than the return interval since the truck's last departure. */
export function isOverdue(lastDepartedAtMs: number | null, nowMs: number): boolean {
  if (lastDepartedAtMs === null) return false;
  return nowMs - lastDepartedAtMs > RETURN_INTERVAL_MS;
}

export function linkState(
  expiresAtMs: number,
  revokedAtMs: number | null,
  nowMs: number,
): LinkState {
  if (revokedAtMs !== null) return 'revoked';
  return nowMs < expiresAtMs ? 'live' : 'expired';
}

/** A held booking is expired from exactly its hold_expires_at. */
export function holdIsLive(holdExpiresAtMs: number | null, nowMs: number): boolean {
  if (holdExpiresAtMs === null) return false;
  return nowMs < holdExpiresAtMs;
}

export function reportedStatus(
  status: BookingStatus,
  holdExpiresAtMs: number | null,
  nowMs: number,
): BookingStatus {
  if (status === 'held' && !holdIsLive(holdExpiresAtMs, nowMs)) return 'expired';
  return status;
}

/** Dollars with two decimals and a comma between thousands. */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}.${fraction.toString().padStart(2, '0')}`;
}

export function formatHours(quarters: number): string {
  return (quarters / 4).toFixed(2);
}
