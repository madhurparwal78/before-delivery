import type { Config } from './config.js';

/** Seat freedom, seat assignment and the request deadline — one place each. */

export type LegStatus = 'free' | 'taken';

export interface RideSeatRow {
  seat: number;
  legs: LegStatus[];
}

/** True when a seat is free on every leg of the span [fromIndex, toIndex). */
export function seatFreeOnSpan(legs: LegStatus[], fromIdx: number, toIdx: number): boolean {
  for (let i = fromIdx; i < toIdx; i++) if (legs[i] === 'taken') return false;
  return true;
}

/** The lowest-numbered seats that are free across the whole span, in order. */
export function chooseSeats(seatMap: RideSeatRow[], fromIdx: number, toIdx: number, count: number): number[] | null {
  const free: number[] = [];
  for (const row of seatMap) {
    if (seatFreeOnSpan(row.legs, fromIdx, toIdx)) {
      free.push(row.seat);
      if (free.length === count) return free;
    }
  }
  return free.length === count ? free : null;
}

export function seatsFreeOnSpan(seatMap: RideSeatRow[], fromIdx: number, toIdx: number): number {
  let n = 0;
  for (const row of seatMap) if (seatFreeOnSpan(row.legs, fromIdx, toIdx)) n++;
  return n;
}

/** Request deadline: earlier of created + expiry hours and boarding − cutoff minutes. */
export function requestDeadline(createdAt: number, boardingTime: number, cfg: Config): number {
  const byExpiry = createdAt + cfg.requestExpiryHours * 3_600_000;
  const byCutoff = boardingTime - cfg.requestCutoffMinutes * 60_000;
  return Math.min(byExpiry, byCutoff);
}

/** Booking cutoff for new bookings, by mode. */
export function bookingCutoff(boardingTime: number, mode: 'instant' | 'request', cfg: Config): number {
  const minutes = mode === 'instant' ? cfg.bookingCutoffMinutes : cfg.requestCutoffMinutes;
  return boardingTime - minutes * 60_000;
}

export function holdDeadline(createdAt: number, cfg: Config): number {
  return createdAt + cfg.seatHoldSeconds * 1000;
}
