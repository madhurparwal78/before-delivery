/**
 * The brief's domain rules, each decided here and nowhere else: derived staffing status, the
 * default team size, claim eligibility, schedule overlap, credential status, the
 * free-cancellation cutoff and the charge rule (exact money in integer cents).
 */
import { AGENCY_ZONE, addDays, agencyDate, formatIsoDate, fromWallClockOrAfterGap, wallClockAt } from "../shared/agencyTime.js";

export const SETTINGS = ["medical", "education", "legal"] as const;
export type Setting = (typeof SETTINGS)[number];

export const CREDENTIAL_TYPES = ["NIC", "CDI", "SC:L", "EIPA"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const DEFAULT_CREDENTIAL: Record<Setting, CredentialType> = { medical: "NIC", education: "EIPA", legal: "SC:L" };

export type RequestStatus =
  | "draft"
  | "submitted"
  | "half-staffed"
  | "staffed"
  | "completed"
  | "invoiced"
  | "cancelled_early"
  | "cancelled_late";

export const REQUEST_STATUSES: readonly RequestStatus[] = [
  "draft",
  "submitted",
  "half-staffed",
  "staffed",
  "completed",
  "invoiced",
  "cancelled_early",
  "cancelled_late",
];

export const DEFAULT_ROTATION_MINUTES = 20;

/** Seats are claimed, broadcast and listed as open only while a request is in these statuses. */
export const CLAIMABLE: readonly RequestStatus[] = ["submitted", "half-staffed"];

/** Submitting opens seat A, plus seat B when the job runs longer than an hour. */
export function defaultTeamSize(durationMinutes: number): 1 | 2 {
  return durationMinutes > 60 ? 2 : 1;
}

/** The status a live request takes from its seats after every claim and team-size change. */
export function derivedStatus(seats: readonly { confirmed: boolean }[]): "submitted" | "half-staffed" | "staffed" {
  const confirmed = seats.filter((s) => s.confirmed).length;
  if (confirmed === 0) return "submitted";
  return confirmed === seats.length ? "staffed" : "half-staffed";
}

type CredentialStatus = "uploaded" | "verified" | "expired";

/** A verified credential reads as expired from the day after its expiry date, in agency time. */
export function credentialStatus(verifiedAt: Date | null, expiresOn: string | null, today: string): CredentialStatus {
  if (!verifiedAt || !expiresOn) return "uploaded";
  return expiresOn < today ? "expired" : "verified";
}

/**
 * Claim eligibility as SQL: the interpreter holds a verified credential of the request's type
 * whose expiry is on or after the job's agency date.
 */
export function eligibleSql(interpreterId: string, request: string): string {
  return `EXISTS (SELECT 1 FROM credentials c
    WHERE c.interpreter_id = ${interpreterId}
      AND c.credential_type = ${request}.required_credential
      AND c.verified_at IS NOT NULL
      AND c.expires_on >= (${request}.starts_at AT TIME ZONE '${AGENCY_ZONE}')::date)`;
}

/**
 * Schedule overlap as SQL: the interpreter already holds a confirmed seat whose window
 * [start, end) intersects the request's window. Cancelling frees seats, so held seats are live.
 */
export function overlapSql(interpreterId: string, request: string): string {
  return `EXISTS (SELECT 1 FROM seats held JOIN requests held_request ON held_request.id = held.request_id
    WHERE held.interpreter_id = ${interpreterId}
      AND held_request.starts_at < ${request}.starts_at + make_interval(mins => ${request}.duration_minutes)
      AND ${request}.starts_at < held_request.starts_at + make_interval(mins => held_request.duration_minutes))`;
}

/**
 * Free cancellation ends at the request's local start time on the calendar day two days before
 * the start date, in agency time (a skipped local time resolves to the first instant after it).
 */
export function freeCancelUntil(startsAt: Date): Date {
  const start = wallClockAt(startsAt);
  const day = addDays(formatIsoDate(start), -2);
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return fromWallClockOrAfterGap({ year, month, day: date, hour: start.hour, minute: start.minute });
}

export interface Charge {
  billableMinutes: number;
  seats: number;
  hourlyRateCents: number;
  amountCents: number;
}

const MINIMUM_BILLABLE_MINUTES = 120;
const BILLING_INCREMENT_MINUTES = 15;

/**
 * The charge rule: billable minutes are the larger of 120 and the time rounded up to the next
 * quarter hour; amount = billable × rate × seats ÷ 60, exact, rounded once half up to the cent.
 */
export function chargeFor(minutes: number, hourlyRateCents: number, seats: number): Charge {
  const quarters = Math.ceil(minutes / BILLING_INCREMENT_MINUTES);
  const billableMinutes = Math.max(MINIMUM_BILLABLE_MINUTES, quarters * BILLING_INCREMENT_MINUTES);
  const exact = BigInt(billableMinutes) * BigInt(hourlyRateCents) * BigInt(seats);
  const amountCents = Number((2n * exact + 60n) / 120n);
  return { billableMinutes, seats, hourlyRateCents, amountCents };
}

/** Integer cents to the API's dollar string ("388.13"), by string arithmetic only. */
export function dollars(cents: number): string {
  const digits = String(cents).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** A dollar string with two decimals ("388.13") to integer cents, or null when malformed. */
export function centsOf(text: string): number | null {
  const match = /^(\d{1,9})\.(\d{2})$/.exec(text);
  return match ? Number(`${match[1]}${match[2]}`) : null;
}

export function agencyToday(): string {
  return agencyDate(new Date());
}
