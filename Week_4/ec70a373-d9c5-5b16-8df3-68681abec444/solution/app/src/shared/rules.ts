// Booking rules the server enforces and the dial and dialogs preview. Each is decided here only.
import { addDays, type IsoDate, type WallMinutes } from "./time.ts";
import type { BookingStatus, Hours } from "./api.ts";

export type StationKind = "oven" | "mixer" | "blast_chiller" | "prep_table";

/** Quarter hours: every hour amount is held as a whole number of quarter hours. */
export type Quarters = number;
/** Integer US cents. */
export type Cents = number;

export const BOOKING_STEP_MINUTES = 15;
export const HOLD_LIMIT = 3;
/** A no-show can be marked from this long after the start. */
export const NO_SHOW_AFTER_MINUTES = 30;
/** A check-in opens this long before the start. */
export const CHECK_IN_BEFORE_MINUTES = 15;
export const BOOKING_HORIZON_DAYS = 90;
/** A lot is valid through the home-site local purchase date plus this many days. */
export const LOT_VALID_DAYS = 60;
const NEXT_DAY_CUTOFF: WallMinutes = 18 * 60;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Sanitation buffer after every held, confirmed or checked-in booking, by station kind. */
export const SANITATION_BUFFER_MINUTES: Record<StationKind, number> = {
  blast_chiller: 45,
  oven: 30,
  mixer: 30,
  prep_table: 15,
};

/** Quarter hours as the JSON hours number the API publishes. */
export function quartersToHours(q: Quarters): Hours {
  return q / 4;
}

/** A published hours number (always a multiple of 0.25) back to whole quarter hours. */
export function hoursToQuarters(hours: Hours): Quarters {
  return Math.round(hours * 4);
}

/** The hold expiry instant: a hold is expired from exactly its `hold_expires_at`, with no grace band. */
export function holdExpired(holdExpiresAtMs: number, nowMs: number): boolean {
  return nowMs >= holdExpiresAtMs;
}

/** Whether a booking in this state occupies its station at `nowMs`: live holds, confirmed and checked-in bookings. */
export function occupiesStation(status: BookingStatus, holdExpiresAtMs: number | null, nowMs: number): boolean {
  if (status === "confirmed" || status === "checked_in") return true;
  return status === "held" && holdExpiresAtMs !== null && !holdExpired(holdExpiresAtMs, nowMs);
}

/** Where a booking's occupied span ends: its end plus the sanitation buffer for the station's kind. */
export function occupiedUntil(endAtMs: number, kind: StationKind): number {
  return endAtMs + SANITATION_BUFFER_MINUTES[kind] * MINUTE_MS;
}

/** Two spans overlap when they share any stretch of time; touching endpoints do not. */
export function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** A booking for this date is refused with `cutoff` at this site-local moment. */
export function isClosedForBooking(date: IsoDate, siteDate: IsoDate, siteMinutes: WallMinutes): boolean {
  if (date <= siteDate) return true;
  return date === addDays(siteDate, 1) && siteMinutes >= NEXT_DAY_CUTOFF;
}

/** The first date a member can still book at this site-local moment. */
export function nextOpenDate(siteDate: IsoDate, siteMinutes: WallMinutes): IsoDate {
  const tomorrow = addDays(siteDate, 1);
  return isClosedForBooking(tomorrow, siteDate, siteMinutes) ? addDays(siteDate, 2) : tomorrow;
}

export interface ForfeitSplit {
  refunded: Quarters;
  forfeited: Quarters;
}

/**
 * The cancellation outcome: a held booking is refunded in full; a confirmed one by elapsed notice —
 * 72 h or more refunds all, 48 h or more forfeits half its quarter hours rounded up, less forfeits all.
 */
export function cancellationSplit(status: BookingStatus, quarters: Quarters, noticeMs: number): ForfeitSplit {
  if (status === "held" || noticeMs >= 72 * HOUR_MS) return { refunded: quarters, forfeited: 0 };
  if (noticeMs >= 48 * HOUR_MS) {
    const forfeited = (quarters + 1) >> 1;
    return { refunded: quarters - forfeited, forfeited };
  }
  return { refunded: 0, forfeited: quarters };
}

/** A valid-through date is lapsed once the site's date is past it. */
export function validThroughLapsed(validThrough: IsoDate, siteToday: IsoDate): boolean {
  return validThrough < siteToday;
}

/** `YYYY-MM` from 2000-01 to 2099-12. */
export function isReportMonth(value: string): boolean {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
}

/** Whole minutes from the booked end to `atMs`, seconds dropped, never below zero. */
export function lateMinutes(endAtMs: number, atMs: number): number {
  return Math.max(0, Math.floor((atMs - endAtMs) / MINUTE_MS));
}
