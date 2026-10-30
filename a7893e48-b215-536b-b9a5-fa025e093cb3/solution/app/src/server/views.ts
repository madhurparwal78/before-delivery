import { all, one, type Db } from "./db.js";
import type { JsonObject } from "./http.js";
import { packBalance } from "./ledger.js";
import { packSplit, timeCents } from "../shared/pricing.js";
import { refundTier, termsLine, unpaidCutoff } from "./rules.js";
import type { BookingRow, HoldRow } from "./scope.js";
import { elapsedMinutes, localDate, localStamp, localTime } from "./time.js";

export interface PolicyVersion { id: string; site_id: string; notice_hours: number; effective_from: string; effective_at: Date; created_by_name: string; created_at: Date }

/** The version whose effective_at is latest and not after `at` (brief: Cancellation terms). */
export async function policyInForce(db: Db, siteId: string, at: Date): Promise<PolicyVersion> {
  const version = await one<PolicyVersion>(db,
    "SELECT * FROM policy_versions WHERE site_id = $1 AND effective_at <= $2 ORDER BY effective_at DESC LIMIT 1", [siteId, at]);
  if (!version) throw new Error(`No policy version in force for ${siteId}`);
  return version;
}

export interface Occurrence { position: number; local_date: string; start_at: Date; end_at: Date }

interface HoldContext { time_zone: string; rate_cents: number; deposit_cents: number }

/** The hold body, with its quote built from the renter's pack balance at this moment. */
export async function holdJson(db: Db, hold: HoldRow, status: string, now: Date): Promise<{ json: JsonObject; packMinutes: number }> {
  const [context] = await all<HoldContext>(db,
    "SELECT s.time_zone, st.rate_cents, s.deposit_cents FROM stations st JOIN sites s ON s.id = st.site_id WHERE st.id = $1", [hold.station_id]);
  const { time_zone: zone, rate_cents: rate, deposit_cents: deposit } = context as HoldContext;
  const occurrences = await all<Occurrence>(db, "SELECT * FROM hold_occurrences WHERE hold_id = $1 ORDER BY position", [hold.id]);
  const minutes = occurrences.map((occurrence) => elapsedMinutes(occurrence.start_at, occurrence.end_at));
  const available = (await packBalance(db, hold.renter_id)).available;
  const pack = packSplit(minutes, available);
  const cardMinutes = minutes.map((total, index) => total - (pack[index] ?? 0));
  const policy = await policyInForce(db, hold.site_id, now);
  const json: JsonObject = {
    id: hold.id, status, station_id: hold.station_id, site_id: hold.site_id, renter_id: hold.renter_id,
    created_at: hold.created_at.toISOString(), expires_at: hold.expires_at.toISOString(),
    occurrences: occurrences.map((occurrence, index) => ({
      date: occurrence.local_date, start: localTime(zone, occurrence.start_at), end: localTime(zone, occurrence.end_at),
      start_at: occurrence.start_at.toISOString(), end_at: occurrence.end_at.toISOString(), minutes: minutes[index] ?? 0,
      local_start: localStamp(zone, occurrence.start_at), local_end: localStamp(zone, occurrence.end_at),
      due_by: unpaidCutoff(zone, occurrence.start_at).toISOString(),
    })),
    quote: {
      pack_minutes_available: available,
      pack_minutes: pack.reduce((sum, value) => sum + value, 0),
      card_minutes: cardMinutes.reduce((sum, value) => sum + value, 0),
      card_cents: cardMinutes.reduce((sum, value) => sum + timeCents(value, rate), 0),
      deposit_cents: deposit * cardMinutes.filter((value) => value > 0).length,
    },
    terms: termsLine(policy.notice_hours),
  };
  return { json, packMinutes: pack.reduce((sum, value) => sum + value, 0) };
}

export interface BookingViewRow extends BookingRow {
  station_name: string; rate_cents: number; renter_business: string; renter_name: string; time_zone: string; site_name: string;
  notice_hours: number; effective_from: string;
}

export const BOOKING_VIEW = `
  SELECT b.*, st.name AS station_name, st.rate_cents, r.business AS renter_business, r.name AS renter_name,
         s.time_zone, s.name AS site_name, pv.notice_hours, pv.effective_from
    FROM bookings b JOIN stations st ON st.id = b.station_id JOIN renters r ON r.id = b.renter_id
    JOIN sites s ON s.id = b.site_id JOIN policy_versions pv ON pv.id = b.policy_version_id`;

export async function bookingView(db: Db, bookingId: string): Promise<BookingViewRow> {
  const row = await one<BookingViewRow>(db, `${BOOKING_VIEW} WHERE b.id = $1`, [bookingId]);
  if (!row) throw new Error(`Booking ${bookingId} vanished`);
  return row;
}

/** Paid means no card minutes, or Kill Bill holds the time payment. */
export const isPaid = (booking: BookingRow): boolean => booking.card_minutes === 0 || booking.time_payment_id !== null;

export function balanceDue(booking: BookingRow): number {
  return booking.status === "confirmed" && !isPaid(booking) ? booking.card_cents : 0;
}

export function bookingJson(row: BookingViewRow, now: Date): JsonObject {
  const zone = row.time_zone;
  return {
    id: row.id, hold_id: row.hold_id, site_id: row.site_id, station_id: row.station_id, station_name: row.station_name,
    renter_id: row.renter_id, renter_business: row.renter_business, status: row.status,
    start_at: row.start_at.toISOString(), end_at: row.end_at.toISOString(),
    local_start: localStamp(zone, row.start_at), local_end: localStamp(zone, row.end_at), local_date: localDate(zone, row.start_at),
    minutes: row.minutes, pack_minutes: row.pack_minutes, card_minutes: row.card_minutes, card_cents: row.card_cents,
    deposit_cents: row.deposit_cents, paid: isPaid(row), balance_due_cents: balanceDue(row),
    balance_due_by: row.card_minutes > 0 && row.cutoff_at ? row.cutoff_at.toISOString() : null,
    policy: { version_id: row.policy_version_id, notice_hours: row.notice_hours, effective_from: row.effective_from },
    confirmed_at: row.confirmed_at.toISOString(),
    checked_in_at: row.checked_in_at?.toISOString() ?? null, checked_out_at: row.checked_out_at?.toISOString() ?? null,
    overrun_minutes: row.overrun_minutes, overrun_cents: row.overrun_cents, cleaning_fee_cents: row.cleaning_fee_cents,
    terms: termsLine(row.notice_hours),
    cancel_tier: refundTier(row.start_at, row.notice_hours, now),
    refund: { pack_minutes_returned: row.pack_returned_minutes, card_refund_cents: row.card_refund_cents, deposit_refund_cents: row.deposit_refund_cents },
  };
}

export function invoiceJson(row: BookingViewRow): JsonObject {
  const zone = row.time_zone;
  const lines: JsonObject[] = [{
    description: `Station time, ${row.station_name}, ${localStamp(zone, row.start_at)} – ${localStamp(zone, row.end_at)} (pack ${(row.pack_minutes / 60).toFixed(2)} h, card ${(row.card_minutes / 60).toFixed(2)} h)`,
    minutes: row.minutes, amount_cents: row.card_cents,
  }];
  if (row.deposit_cents > 0) lines.push({ description: "Damage deposit", minutes: null, amount_cents: row.deposit_cents });
  if (row.overrun_cents !== null) lines.push({ description: "Overrun", minutes: row.overrun_minutes, amount_cents: row.overrun_cents });
  if (row.cleaning_fee_cents !== null) lines.push({ description: "Cleaning fee", minutes: null, amount_cents: row.cleaning_fee_cents });
  const total = lines.reduce((sum, line) => sum + Number(line.amount_cents), 0);
  const paid = (row.time_payment_id ? row.card_cents : 0) + (row.deposit_payment_id ? row.deposit_cents : 0)
    + (row.overrun_payment_id ? row.overrun_cents ?? 0 : 0) + (row.cleaning_payment_id ? row.cleaning_fee_cents ?? 0 : 0);
  return {
    booking_id: row.id, renter_business: row.renter_business, site_name: row.site_name, lines, total_cents: total,
    paid_cents: paid, refunded_cents: row.card_refund_cents + row.deposit_refund_cents, balance_due_cents: balanceDue(row),
    terms: termsLine(row.notice_hours),
  };
}
