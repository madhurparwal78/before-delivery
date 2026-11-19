import { config } from '../config.js';
import { addDays, addMinutes, addSeconds, hoursBetween } from './time.js';

export const BOOKING_STATES = [
  'held',
  'requested',
  'confirmed',
  'expired',
  'declined',
  'withdrawn',
  'cancelled_by_passenger',
  'cancelled_by_driver',
  'completed',
  'rated',
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

/** `accepted` is written only to history, immediately followed by `confirmed`. */
export type HistoryState = BookingState | 'accepted';

/** States in which a booking still holds its seats on its own legs. */
export function holdsSeats(state: BookingState): boolean {
  return state === 'held' || state === 'requested' || state === 'confirmed';
}

export function isEnded(state: BookingState): boolean {
  return (
    state === 'expired' ||
    state === 'declined' ||
    state === 'withdrawn' ||
    state === 'cancelled_by_passenger' ||
    state === 'cancelled_by_driver'
  );
}

/** A hold ends at its creation plus SEAT_HOLD_SECONDS. */
export function holdDeadline(createdAt: Date): Date {
  return addSeconds(createdAt, config.limits.seatHoldSeconds);
}

/**
 * A request's deadline is the earlier of creation + REQUEST_EXPIRY_HOURS and
 * boarding time − REQUEST_CUTOFF_MINUTES. It is recomputed when the departure moves.
 */
export function requestDeadline(createdAt: Date, boardingTime: Date): Date {
  const byAge = addMinutes(createdAt, config.limits.requestExpiryHours * 60);
  const byCutoff = addMinutes(boardingTime, -config.limits.requestCutoffMinutes);
  return byAge.getTime() <= byCutoff.getTime() ? byAge : byCutoff;
}

export function expiresInSeconds(deadline: Date, at: Date): number {
  return Math.max(0, Math.ceil((deadline.getTime() - at.getTime()) / 1000));
}

/** Booking closes this many minutes before boarding, by mode. */
export function bookingCutoffMinutes(mode: 'instant' | 'request'): number {
  return mode === 'instant'
    ? config.limits.bookingCutoffMinutes
    : config.limits.requestCutoffMinutes;
}

export function bookingClosed(
  mode: 'instant' | 'request',
  boardingTime: Date,
  at: Date,
): boolean {
  const cutoff = addMinutes(boardingTime, -bookingCutoffMinutes(mode));
  return at.getTime() >= cutoff.getTime();
}

export interface CancelQuote {
  refund_cents: number;
  kept_cents: number;
  percent: number;
  hours_before: number;
  reason: 'tier' | 'free_window';
}

/**
 * The one refund decision: the free-cancel window first, then the hour tiers measured
 * from server time to the booking's boarding time.
 */
export function cancelQuote(
  paidCents: number,
  boardingTime: Date,
  at: Date,
  freeCancelUntil: Date | null,
): CancelQuote {
  const hoursBefore = Math.max(0, Math.floor(hoursBetween(at, boardingTime)));
  if (freeCancelUntil && at.getTime() < freeCancelUntil.getTime()) {
    return {
      refund_cents: paidCents,
      kept_cents: 0,
      percent: 100,
      hours_before: hoursBefore,
      reason: 'free_window',
    };
  }
  const hoursLeft = hoursBetween(at, boardingTime);
  if (hoursLeft > config.limits.refundFullHours) {
    return {
      refund_cents: paidCents,
      kept_cents: 0,
      percent: 100,
      hours_before: hoursBefore,
      reason: 'tier',
    };
  }
  if (hoursLeft >= config.limits.refundHalfHours) {
    const refund = Math.floor((paidCents * config.limits.refundHalfPercent) / 100);
    return {
      refund_cents: refund,
      kept_cents: paidCents - refund,
      percent: config.limits.refundHalfPercent,
      hours_before: hoursBefore,
      reason: 'tier',
    };
  }
  return {
    refund_cents: 0,
    kept_cents: paidCents,
    percent: 0,
    hours_before: hoursBefore,
    reason: 'tier',
  };
}

/**
 * A departure moved by more than FREE_CANCEL_SHIFT_MINUTES opens a full-refund window
 * that runs until the new departure minus two hours.
 */
export function freeCancelWindow(
  previousDeparture: Date,
  newDeparture: Date,
): Date | null {
  const shiftMinutes = Math.abs(newDeparture.getTime() - previousDeparture.getTime()) / 60000;
  if (shiftMinutes <= config.limits.freeCancelShiftMinutes) return null;
  return addMinutes(newDeparture, -120);
}

export function ratingWindowClose(arrival: Date): Date {
  return addDays(arrival, config.limits.ratingWindowDays);
}

export type RatingState = 'not_open' | 'open' | 'waiting' | 'revealed' | 'closed';

/** The one rating-state decision, used by the route, the job and the live event. */
export function ratingState(input: {
  bookingState: BookingState;
  closesAt: Date | null;
  submitted: number;
  at: Date;
}): RatingState {
  if (input.bookingState === 'rated') return 'revealed';
  if (input.bookingState !== 'completed' || !input.closesAt) return 'not_open';
  if (input.at.getTime() >= input.closesAt.getTime()) {
    return input.submitted > 0 ? 'revealed' : 'closed';
  }
  return input.submitted === 0 ? 'open' : 'waiting';
}
