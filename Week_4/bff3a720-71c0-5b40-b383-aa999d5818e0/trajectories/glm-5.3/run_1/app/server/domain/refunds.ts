import type { Config } from './config.js';

/** Refund tiers and the free-cancel window — the only place they are decided. */

export type CancelReason = 'tier' | 'free_window';

export interface CancelQuote {
  refundCents: number;
  keptCents: number;
  percent: number;
  hoursBefore: number;
  reason: CancelReason;
}

export function refundTier(paidCents: number, now: number, boardingTime: number, cfg: Config): CancelQuote {
  const msLeft = boardingTime - now;
  const hours = msLeft / 3_600_000;
  if (hours > cfg.refundFullHours) {
    return { refundCents: paidCents, keptCents: 0, percent: 100, hoursBefore: Math.floor(hours), reason: 'tier' };
  }
  if (hours >= cfg.refundHalfHours) {
    const refund = Math.floor((paidCents * cfg.refundHalfPercent) / 100);
    return { refundCents: paidCents - refund, keptCents: refund, percent: cfg.refundHalfPercent, hoursBefore: Math.floor(hours), reason: 'tier' };
  }
  return { refundCents: 0, keptCents: paidCents, percent: 0, hoursBefore: Math.floor(Math.max(hours, 0)), reason: 'tier' };
}

export function freeCancelQuote(paidCents: number, now: number, boardingTime: number, freeCancelUntil: number | null, cfg: Config): CancelQuote | null {
  if (freeCancelUntil === null) return null;
  if (now < freeCancelUntil) {
    return { refundCents: paidCents, keptCents: 0, percent: 100, hoursBefore: hoursBeforeRounded(now, boardingTime), reason: 'free_window' };
  }
  return null;
}

function hoursBeforeRounded(now: number, boardingTime: number): number {
  return Math.floor(Math.max(0, (boardingTime - now) / 3_600_000));
}

export function cancelQuote(paidCents: number, now: number, boardingTime: number, freeCancelUntil: number | null, cfg: Config): CancelQuote {
  return freeCancelQuote(paidCents, now, boardingTime, freeCancelUntil, cfg) ?? refundTier(paidCents, now, boardingTime, cfg);
}

/** The free-cancel deadline a qualifying time change grants: new departure − 2 hours. */
export function freeCancelDeadline(newDeparture: number): number {
  return newDeparture - 2 * 3_600_000;
}

/** Whether a departure move is big enough to open the free-cancel window. */
export function shiftQualifies(oldDeparture: number, newDeparture: number, cfg: Config): boolean {
  return Math.abs(newDeparture - oldDeparture) > cfg.freeCancelShiftMinutes * 60_000;
}
