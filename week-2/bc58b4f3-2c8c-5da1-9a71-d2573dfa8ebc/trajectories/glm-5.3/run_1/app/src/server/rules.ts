import type { Tx } from "./config";
import { ApiError } from "./errors";
import { businessMinutes } from "../shared/time";
import { seatCountFor, serviceLineOf } from "../shared/domain";

// ── State transitions (single source of truth) ──────────────────────────────

export type Status = string;

export const RELEASE_FROM: readonly Status[] = ["draft"];

export const CLAIM_FROM: readonly Status[] = ["released", "partially_covered"];

export const GIVE_BACK_STATUSES: readonly Status[] = ["partially_covered", "covered"];

export const CHANGE_TIME_STATUSES: readonly Status[] = ["draft", "released", "partially_covered", "covered"];

export const EDIT_DETAIL_STATUSES: readonly Status[] = CHANGE_TIME_STATUSES;

export const VERIFY_STATUSES: readonly Status[] = ["covered", "served"];

export const CANCEL_FROM: readonly Status[] = ["draft", "released", "partially_covered", "covered"];

export const BILLABLE_STATUSES: readonly Status[] = ["verified", "cancelled"];

export function assertTransition(from: Status, allowed: readonly Status[], action: string): void {
  if (!allowed.includes(from)) {
    throw new ApiError("invalid_transition", `Cannot ${action} a request in this status.`);
  }
}

// ── Business minutes (single source of truth) ────────────────────────────────

export const LATE_NOTICE_BUSINESS_MINUTES = 2880;

/** Notice measured from the moment the server receives the request to the assignment start. */
export function noticeBusinessMinutes(receivedAt: Date, startAt: Date): number {
  return businessMinutes(receivedAt, startAt);
}

export function isLateNotice(receivedAt: Date, startAt: Date): boolean {
  return noticeBusinessMinutes(receivedAt, startAt) < LATE_NOTICE_BUSINESS_MINUTES;
}

// ── Seats (single source of truth) ───────────────────────────────────────────

export function seatCount(language: string, durationMinutes: number): number {
  return seatCountFor(language, durationMinutes);
}

export function serviceLine(language: string): "asl" | "spoken" {
  return serviceLineOf(language);
}

// ── Billable minutes and mileage (single source of truth) ───────────────────

export const MIN_BILLABLE_MINUTES = 120;
export const BILLABLE_STEP = 15;
export const FREE_ROUND_TRIP_MILES = 40;

/** The greater of two hours and actual minutes rounded up to the quarter hour. */
export function billableMinutes(actualMinutes: number): number {
  return Math.max(MIN_BILLABLE_MINUTES, Math.ceil(actualMinutes / BILLABLE_STEP) * BILLABLE_STEP);
}

export function billableMiles(roundTripMiles: number): number {
  return Math.max(0, roundTripMiles - FREE_ROUND_TRIP_MILES);
}

/** hourly rate cents × minutes ÷ 60, rounded half-up to a whole cent. */
export function seatAmountCents(hourlyRateCents: number, minutes: number): number {
  // Integer arithmetic: (rate * minutes * 2 + 60) / 120 rounded down = half-up.
  return Math.floor((hourlyRateCents * minutes * 2 + 60) / 120);
}

export function mileageCents(billableMilesValue: number, centsPerMile: number): number {
  return billableMilesValue * centsPerMile;
}

// ── Cancellation fee (single source of truth) ───────────────────────────────

export interface FeeDecision {
  fee_applies: boolean;
  business_minutes_notice: number;
  fee_cents: number;
}

export function cancellationFee(
  status: string,
  receivedAt: Date,
  startAt: Date,
  seatCountValue: number,
  hourlyRateCents: number,
): FeeDecision {
  const notice = noticeBusinessMinutes(receivedAt, startAt);
  const feeApplies = status !== "draft" && isLateNotice(receivedAt, startAt);
  const fee = feeApplies ? seatAmountCents(hourlyRateCents, MIN_BILLABLE_MINUTES) * seatCountValue : 0;
  return { fee_applies: feeApplies, business_minutes_notice: notice, fee_cents: fee };
}

// ── Rate in force (single source of truth) ──────────────────────────────────

export interface RateEntry {
  org_code: string;
  service_line: string;
  effective_from: string;
  hourly_rate_cents: number;
  mileage_cents_per_mile: number;
}

/** The entry in force on the assignment's Central start date: latest effective_from ≤ start date. */
export async function rateInForce(tx: Tx, orgCode: string, line: "asl" | "spoken", startDateISO: string): Promise<RateEntry> {
  const res = await tx.query(
    `SELECT org_code, service_line, effective_from::text AS effective_from,
            hourly_rate_cents, mileage_cents_per_mile
       FROM rate_cards
      WHERE org_code = $1 AND service_line = $2 AND effective_from <= $3::date
      ORDER BY effective_from DESC
      LIMIT 1`,
    [orgCode, line, startDateISO],
  );
  if (!res.rows.length) {
    throw new ApiError("not_billable", "No rate card entry is in force for this organisation.");
  }
  return res.rows[0] as RateEntry;
}

// ── Uncovered minutes (single source of truth) ──────────────────────────────

/** duration × open seats summed over draft, released and partially_covered assignments starting in the week. */
export const UNCOVERED_STATUSES: readonly Status[] = ["draft", "released", "partially_covered"];
