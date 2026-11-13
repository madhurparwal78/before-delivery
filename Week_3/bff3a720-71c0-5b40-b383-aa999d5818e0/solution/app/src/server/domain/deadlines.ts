import { plusMinutes, plusSeconds } from "../clock";
import { config } from "../config";
import type { BookingMode } from "../../shared/api";

/** A hold ends when now reaches its creation plus SEAT_HOLD_SECONDS. */
export function holdEnd(createdAt: Date): Date {
  return plusSeconds(createdAt, config.seatHoldSeconds);
}

/** The earlier of creation + REQUEST_EXPIRY_HOURS and boarding − REQUEST_CUTOFF_MINUTES. */
export function requestDeadline(createdAt: Date, boardingTime: Date): Date {
  const byAge = plusSeconds(createdAt, config.requestExpiryHours * 3600);
  const byCutoff = plusMinutes(boardingTime, -config.requestCutoffMinutes);
  return byAge.getTime() <= byCutoff.getTime() ? byAge : byCutoff;
}

/** Minutes before boarding at which a new booking is refused. */
export function bookingCutoffMinutes(mode: BookingMode): number {
  return mode === "instant" ? config.bookingCutoffMinutes : config.requestCutoffMinutes;
}

export function bookingClosesAt(mode: BookingMode, boardingTime: Date): Date {
  return plusMinutes(boardingTime, -bookingCutoffMinutes(mode));
}

/** At or after the deadline the request counts as expired. */
export function isDue(deadline: Date, at: Date): boolean {
  return at.getTime() >= deadline.getTime();
}
