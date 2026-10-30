// The rate in force and the charges of a billable assignment.
import { agencyDate } from "../shared/time.js";
import type { Db } from "./db.js";
import { pool } from "./db.js";
import { ApiError } from "./http.js";
import type { AssignmentRecord, ChargeLine, Charges } from "./records.js";
import { MINIMUM_BILLABLE_MINUTES, billableMinutes, lateCancellationSeatCents, mileage, seatAmountCents, serviceLine } from "./rules.js";

export interface RateEntry {
  org: string;
  service_line: "asl" | "spoken";
  effective_from: string;
  hourly_rate_cents: number;
  mileage_cents_per_mile: number;
}

/** The entry with the latest effective date on or before the assignment's Central start date. */
export async function rateInForce(
  orgCode: string,
  languageCode: string,
  startAt: Date,
  db: Db | typeof pool = pool,
): Promise<RateEntry> {
  const found = await db.query<RateEntry>(
    `SELECT org_code AS org, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile
       FROM rate_cards
      WHERE org_code = $1 AND service_line = $2 AND effective_from <= $3
      ORDER BY effective_from DESC LIMIT 1`,
    [orgCode, serviceLine(languageCode), agencyDate(startAt.toISOString())],
  );
  // Every organisation and service line has a seeded entry from 2026-01-01, before any bookable date.
  return found.rows[0]!;
}

function total(lines: ChargeLine[]): number {
  return lines.reduce((sum, line) => sum + line.amount_cents + line.mileage_cents, 0);
}

/**
 * The charges of a billable assignment: the snapshot once queued or posted, the decided late-cancellation fee,
 * or service lines from the verifications at the rate in force. Anything else is not billable.
 */
export async function chargesFor(record: AssignmentRecord, db: Db | typeof pool = pool): Promise<Charges> {
  if (record.billedCharges) return record.billedCharges;
  const decision = record.cancellation;
  if (record.status === "cancelled" && decision?.feeApplies && decision.rate) {
    const amount = lateCancellationSeatCents(decision.rate.hourlyRateCents);
    const lines = Array.from({ length: decision.seats }, (_, index) => ({
      seat: index + 1,
      actual_minutes: null,
      billable_minutes: MINIMUM_BILLABLE_MINUTES,
      amount_cents: amount,
      round_trip_miles: 0,
      billable_miles: 0,
      mileage_cents: 0,
    }));
    return {
      number: record.number,
      kind: "late_cancellation",
      rate: {
        effective_from: decision.rate.effectiveFrom,
        hourly_rate_cents: decision.rate.hourlyRateCents,
        mileage_cents_per_mile: decision.rate.mileageCentsPerMile,
      },
      lines,
      total_cents: total(lines),
    };
  }
  if (record.status !== "verified") throw new ApiError("not_billable");
  const rate = await rateInForce(record.orgCode, record.languageCode, record.startAt, db);
  const verified = await db.query<{ seat: number; actual_minutes: number; round_trip_miles: number }>(
    "SELECT seat, actual_minutes, round_trip_miles FROM verifications WHERE assignment_id = $1 ORDER BY seat",
    [record.id],
  );
  const lines = verified.rows.map((v) => {
    const minutes = billableMinutes(v.actual_minutes);
    const travel = mileage(v.round_trip_miles, rate.mileage_cents_per_mile);
    return {
      seat: v.seat,
      actual_minutes: v.actual_minutes,
      billable_minutes: minutes,
      amount_cents: seatAmountCents(rate.hourly_rate_cents, minutes),
      round_trip_miles: v.round_trip_miles,
      billable_miles: travel.billableMiles,
      mileage_cents: travel.mileageCents,
    };
  });
  return {
    number: record.number,
    kind: "service",
    rate: {
      effective_from: rate.effective_from,
      hourly_rate_cents: rate.hourly_rate_cents,
      mileage_cents_per_mile: rate.mileage_cents_per_mile,
    },
    lines,
    total_cents: total(lines),
  };
}

interface BillingView {
  status: AssignmentRecord["billingStatus"];
  invoice_id: string | null;
  total_cents: number | null;
}

/** The billing block of a view, from charges already computed (null while nothing is billable). */
export function billingFrom(record: AssignmentRecord, charges: Charges | null): BillingView {
  return { status: record.billingStatus, invoice_id: record.invoiceId, total_cents: charges ? charges.total_cents : null };
}

export async function billingView(record: AssignmentRecord, db: Db | typeof pool = pool): Promise<BillingView> {
  return billingFrom(record, record.billingStatus === "none" ? null : await chargesFor(record, db));
}
