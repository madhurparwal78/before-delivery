import type { Contract, Quote } from "../shared/api.js";
import { isChargedCancellation } from "../shared/status.js";
import { isoAt, lateCutoff } from "./agency.js";
import { type BookingData, heldCount } from "./bookings.js";
import { priceBooking } from "./billing.js";

/** The cancellation quote, computed afresh from the booking, its contract and the server clock. */
export function quoteCancellation(data: BookingData, contract: Contract, nowMs: number): Quote {
  const cutoffMs = lateCutoff(data.row.start_at.getTime());
  const late = nowMs > cutoffMs;
  const count = heldCount(data);
  const { arithmetic } = priceBooking(data, contract, data.row.duration_minutes, 0);
  const charged = isChargedCancellation({ late, interpreter_count: count });
  return {
    late,
    cutoff: isoAt(cutoffMs),
    interpreter_count: count,
    billable_minutes: charged ? arithmetic.billable_minutes : 0,
    charge_cents: charged ? arithmetic.amount_cents : 0,
  };
}
