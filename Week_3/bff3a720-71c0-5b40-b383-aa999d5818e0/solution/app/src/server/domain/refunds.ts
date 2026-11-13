import type { CancelQuote } from "../../shared/api";
import { config } from "../config";

const HOUR_MS = 3_600_000;

/** The free-cancel window ends this many hours before the new departure. */
const FREE_WINDOW_LEAD_HOURS = 2;

export function freeCancelUntil(newDeparture: Date): Date {
  return new Date(newDeparture.getTime() - FREE_WINDOW_LEAD_HOURS * HOUR_MS);
}

/** A departure move qualifies for the free window when it exceeds FREE_CANCEL_SHIFT_MINUTES either way. */
export function qualifiesForFreeWindow(oldDeparture: Date, newDeparture: Date): boolean {
  return Math.abs(newDeparture.getTime() - oldDeparture.getTime()) > config.freeCancelShiftMinutes * 60_000;
}

interface QuoteInput {
  paidCents: number;
  boardingTime: Date;
  now: Date;
  freeCancelUntil: Date | null;
}

/** Cents refunded at a whole percent of the amount paid; the driver keeps the rest. */
export function refundAtPercent(paidCents: number, percent: number): number {
  return Math.floor((paidCents * percent) / 100);
}

/** The one refund rule: what a passenger cancellation at `now` refunds and the driver keeps; null once boarding time has come. */
export function cancelQuote(input: QuoteInput): CancelQuote | null {
  const msBefore = input.boardingTime.getTime() - input.now.getTime();
  if (msBefore <= 0) return null;
  const hoursBefore = Math.floor(msBefore / HOUR_MS);
  const inFreeWindow = input.freeCancelUntil !== null && input.now.getTime() < input.freeCancelUntil.getTime();
  if (inFreeWindow) {
    return { refund_cents: input.paidCents, kept_cents: 0, percent: 100, hours_before: hoursBefore, reason: "free_window" };
  }
  let percent: number;
  if (msBefore > config.refundFullHours * HOUR_MS) percent = 100;
  else if (msBefore >= config.refundHalfHours * HOUR_MS) percent = config.refundHalfPercent;
  else percent = 0;
  const refund = refundAtPercent(input.paidCents, percent);
  return { refund_cents: refund, kept_cents: input.paidCents - refund, percent, hours_before: hoursBefore, reason: "tier" };
}
