/**
 * Domain: stations, blocks on the dial, the free-slot and cleaning-buffer check,
 * hold-over billing and cancellation charges. One definition per rule.
 */

import type { KitchenClock, KitchenDate, LocalTime } from "../../shared/kitchen-time.js";
import { minutesAtHourlyRate, percentOfCents, roundHalfUpDiv } from "../../shared/money.js";
import type { Booking, BookingStatus, DialBlock, Station } from "../../shared/api-types.js";
import { Db } from "../db.js";

export interface StationRow {
  id: string;
  name: string;
  kind: "hot_line" | "bake_deck" | "cold_prep";
  hourly_rate_cents: number;
  dial_order: number;
}

export interface BookingRow {
  id: string;
  ref: string;
  hold_ref: string;
  tenant_id: string;
  station_id: string;
  date: KitchenDate;
  start_local: LocalTime;
  end_local: LocalTime;
  start: Date;
  end: Date;
  elapsed_minutes: number;
  status: BookingStatus;
  pay_with: "account" | "hour_pack" | null;
  amount_cents: number | null;
  policy_version: number | null;
  notes: string;
  checked_in_at: Date | null;
  checked_out_at: Date | null;
  holdover_reported_minutes: number | null;
  holdover_billed_minutes: number | null;
  holdover_cents: number | null;
  cancelled_at: Date | null;
  cancelled_late: boolean | null;
  fee_cents: number;
  fee_minutes: number;
  fee_refunded: boolean;
  created_at: Date;
}

export interface PolicyRow {
  version: number;
  free_window_hours: number;
  late_fee_percent: number;
  effective_at: Date;
}

/** Bookings that occupy the dial and block slots: live holds and settled bookings. */
export const TAKEN_STATUSES: BookingStatus[] = ["held", "confirmed", "checked_in", "completed"];

export const CLEANING_MINUTES = 30;

export async function loadStations(db: Db): Promise<StationRow[]> {
  return db.query<StationRow>(
    "SELECT id, name, kind, hourly_rate_cents, dial_order FROM stations ORDER BY dial_order"
  );
}

/** A booking as the dial sees it: with its tenant's name and, for holds, the hold's expiry. */
export interface DialBookingRow extends BookingRow {
  tenant_name: string;
  contact_email: string;
  hold_expires_at: Date | null;
}

/**
 * Blocks of one station for one kitchen date, in wall-clock minutes. Live holds count until
 * their expiry; from it, the hold's bookings stop counting as taken.
 */
export async function loadDayBookings(
  db: Db,
  stationId: string,
  date: KitchenDate
): Promise<DialBookingRow[]> {
  return db.query<DialBookingRow>(
    `SELECT b.id, b.ref, b.hold_ref, b.tenant_id, b.station_id, b.date::text AS date,
            b.start_local, b.end_local, b.start, b."end", b.elapsed_minutes, b.status, b.pay_with,
            b.amount_cents, b.policy_version, b.notes, b.checked_in_at, b.checked_out_at,
            b.holdover_reported_minutes, b.holdover_billed_minutes, b.holdover_cents,
            b.cancelled_at, b.cancelled_late, b.fee_cents, b.fee_minutes, b.fee_refunded, b.created_at,
            t.business_name AS tenant_name, t.owner_email AS contact_email, h.expires_at AS hold_expires_at
     FROM bookings b
     JOIN holds h ON h.ref = b.hold_ref
     JOIN tenants t ON t.id = b.tenant_id
     WHERE b.station_id = $1 AND b.date = $2::date AND b.status = ANY($3::text[])
       AND (b.status <> 'held' OR h.expires_at > now())
     ORDER BY b.start`,
    [stationId, date, TAKEN_STATUSES]
  );
}

export interface MinuteBlock {
  tenantId: string;
  start: number; // inclusive wall minute
  end: number; // exclusive wall minute
  booking?: BookingRow;
}

export function toMinuteBlocks(rows: BookingRow[], clock: KitchenClock): MinuteBlock[] {
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    start: clock.minuteOfDay(row.start_local),
    end: clock.minuteOfDay(row.end_local),
    booking: row
  }));
}

/**
 * The cleaning block after each run of one tenant's touching blocks on a station:
 * 30 minutes past the run's end, cut off at 24:00.
 */
export function cleaningBlocks(blocks: MinuteBlock[]): Array<{ start: number; end: number }> {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const cleanings: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < sorted.length) {
    let runEnd = sorted[i].end;
    let j = i;
    while (
      j + 1 < sorted.length &&
      sorted[j + 1].tenantId === sorted[i].tenantId &&
      sorted[j + 1].start <= runEnd
    ) {
      j++;
      runEnd = Math.max(runEnd, sorted[j].end);
    }
    const start = runEnd;
    const end = Math.min(runEnd + CLEANING_MINUTES, 1440);
    if (end > start) cleanings.push({ start, end });
    i = j + 1;
  }
  return cleanings;
}

/**
 * A block is free when it overlaps no taken block, and keeps 30 minutes between itself and
 * every block of a different tenant on both sides. Same-tenant blocks may touch.
 */
export function isFree(
  candidate: { start: number; end: number; tenantId: string },
  blocks: MinuteBlock[]
): boolean {
  for (const block of blocks) {
    if (block.tenantId === candidate.tenantId) {
      if (candidate.start < block.end && block.start < candidate.end) return false;
    } else {
      if (candidate.start < block.end + CLEANING_MINUTES && block.start - CLEANING_MINUTES < candidate.end) {
        return false;
      }
    }
  }
  return true;
}

/** Hold-over grace and rounding: ≤10 reported minutes bill 0; above that, round up to 15s. */
export function billedHoldoverMinutes(reported: number): number {
  if (reported <= 10) return 0;
  return Math.ceil(reported / 15) * 15;
}

export const holdoverAmountCents = (billedMinutes: number, stationHourlyRateCents: number): number =>
  minutesAtHourlyRate(billedMinutes, stationHourlyRateCents);

export interface CancellationOutcome {
  late: boolean;
  feeCents: number;
  feeMinutes: number;
}

/**
 * A cancellation is free at or before start minus the free window; late otherwise.
 * Account bookings: full credit back, plus a late fee in cents. Hour-pack bookings:
 * free returns all minutes; late keeps fee minutes and returns the rest.
 */
export function cancellationOutcome(
  booking: BookingRow,
  policy: { free_window_hours: number; late_fee_percent: number },
  cancelledAt: number
): CancellationOutcome {
  const cutoff = booking.start.getTime() - policy.free_window_hours * 3_600_000;
  const late = cancelledAt > cutoff;
  if (!late) {
    return { late: false, feeCents: 0, feeMinutes: 0 };
  }
  if (booking.pay_with === "hour_pack") {
    return {
      late: true,
      feeCents: 0,
      feeMinutes: roundHalfUpDiv(booking.elapsed_minutes * policy.late_fee_percent, 100)
    };
  }
  const amount = booking.amount_cents ?? 0;
  return { late: true, feeCents: percentOfCents(amount, policy.late_fee_percent), feeMinutes: 0 };
}

export function stationJson(row: StationRow): Station {
  return { id: row.id, name: row.name, kind: row.kind, hourly_rate_cents: row.hourly_rate_cents };
}

/** The dial's anonymous and full block views. */
export function dialBlockFor(
  booking: DialBookingRow,
  viewerRole: "operator" | "tenant" | "own",
  clock: KitchenClock
): DialBlock {
  const startMinute = clock.minuteOfDay(booking.start_local);
  const endMinute = clock.minuteOfDay(booking.end_local);
  if (viewerRole === "tenant") {
    return { kind: "booked", start_minute: startMinute, end_minute: endMinute };
  }
  const isHold = booking.status === "held";
  return {
    kind: isHold ? "hold" : "booking",
    booking_id: booking.id,
    ref: booking.ref,
    hold_ref: booking.hold_ref,
    status: booking.status,
    start_minute: startMinute,
    end_minute: endMinute,
    tenant_id: booking.tenant_id,
    tenant_name: booking.tenant_name,
    notes: booking.notes,
    ...(viewerRole === "operator" ? { contact_email: booking.contact_email } : {}),
    expires_at: isHold && booking.hold_expires_at ? clock.isoOf(booking.hold_expires_at.getTime()) : null
  } as DialBlock;
}
