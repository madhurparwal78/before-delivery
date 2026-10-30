/** Shared JSON builders for bookings, holds and policy versions. */

import { type Booking, type CancellationPolicy } from "../../../shared/api-types.js";
import { centsToDollars } from "../../../shared/money.js";
import type { KitchenClock } from "../../../shared/kitchen-time.js";
import type { BookingRow } from "../../domain/bookings.js";

/** A booking row with the policy version it was confirmed under (null while held). */
export type BookingWithPolicyRow = BookingRow & {
  free_window_hours?: number | null;
  late_fee_percent?: number | null;
};

export function bookingJson(
  row: BookingWithPolicyRow,
  clock: KitchenClock,
  operatorView: boolean,
  tenantName?: string
): Booking {
  const policy =
    row.policy_version === null
      ? null
      : {
          version: row.policy_version,
          free_window_hours: row.free_window_hours ?? 0,
          late_fee_percent: row.late_fee_percent ?? 0
        };
  const booking: Booking = {
    id: row.id,
    ref: row.ref,
    hold_ref: row.hold_ref,
    tenant_id: row.tenant_id,
    station_id: row.station_id,
    date: row.date,
    start_local: row.start_local,
    end_local: row.end_local,
    start: clock.isoOf(row.start.getTime()),
    end: clock.isoOf(row.end.getTime()),
    elapsed_minutes: row.elapsed_minutes,
    status: row.status,
    pay_with: row.pay_with,
    amount_cents: row.amount_cents,
    policy,
    notes: row.notes,
    checked_in_at: row.checked_in_at ? clock.isoOf(row.checked_in_at.getTime()) : null,
    checked_out_at: row.checked_out_at ? clock.isoOf(row.checked_out_at.getTime()) : null,
    holdover:
      row.holdover_reported_minutes !== null
        ? {
            reported_minutes: row.holdover_reported_minutes,
            billed_minutes: row.holdover_billed_minutes ?? 0,
            amount_cents: row.holdover_cents ?? 0
          }
        : null,
    cancellation:
      row.cancelled_at !== null
        ? {
            cancelled_at: clock.isoOf(row.cancelled_at.getTime()),
            late: row.cancelled_late ?? false,
            fee_cents: row.fee_cents,
            fee_minutes: row.fee_minutes,
            fee_refunded: row.fee_refunded
          }
        : null,
    created_at: clock.isoOf(row.created_at.getTime())
  };
  if (operatorView && tenantName !== undefined) {
    booking.tenant_name = tenantName;
  }
  return booking;
}

export const dollars = (cents: number): string => centsToDollars(cents);

export function policyJson(row: {
  version: number;
  free_window_hours: number;
  late_fee_percent: number;
  effective_at: Date;
}): CancellationPolicy {
  return {
    version: row.version,
    free_window_hours: row.free_window_hours,
    late_fee_percent: row.late_fee_percent,
    effective_at: row.effective_at.toISOString()
  };
}
