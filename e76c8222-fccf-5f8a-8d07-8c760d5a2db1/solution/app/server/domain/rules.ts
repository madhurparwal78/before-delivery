// The brief's business rules, each decided by exactly one definition.
import type { Quote } from "../../shared/api.js";
import type { OfferStatus, RequestStatus, Setting } from "../../shared/domain.js";
import { addDays } from "../dates.js";
import { ApiError } from "../errors.js";
import { formatCents, formatHundredths } from "../money.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Team rule: a request longer than 2 hours, or any legal request, has two seats. */
export function seatCount(setting: Setting, start: Date, end: Date): number {
  return setting === "legal" || end.getTime() - start.getTime() > 2 * HOUR ? 2 : 1;
}

/** Scheduled length in hundredths of an hour, rounded half up. */
export function scheduledHundredths(start: Date, end: Date): number {
  const minutes = (end.getTime() - start.getTime()) / MINUTE;
  return Math.round((minutes * 100) / 60);
}

/** Offer expiry: the earlier of 12 h after the pin and 2 h before start (12 h for logged-after). */
export function offerExpiry(pinnedAt: Date, start: Date, loggedAfter: boolean): Date {
  const ttl = pinnedAt.getTime() + 12 * HOUR;
  return new Date(loggedAfter ? ttl : Math.min(ttl, start.getTime() - 2 * HOUR));
}

/**
 * An offer past its `expires_at` is expired: the one predicate, for the offer alias `o` at the SQL
 * time `at`, that is true while an active offer is still open.
 */
export const openOfferSql = (at = "now()"): string => `(o.status = 'active' AND o.expires_at > ${at})`;

/** An offer that holds its seat: accepted, or active and not yet expired. */
export const holdingOfferSql = (at = "now()"): string => `(o.status = 'accepted' OR ${openOfferSql(at)})`;

/** An active offer whose expiry has passed but is not yet recorded as expired. */
export const LAPSED_OFFER_SQL = `(o.status = 'active' AND NOT ${openOfferSql()})`;

/** An offer's status as read: the same expiry rule, applied before the sweep records it. */
export function offerStatus(status: OfferStatus, expiresAt: Date, now: Date): OfferStatus {
  return status === "active" && expiresAt.getTime() <= now.getTime() ? "expired" : status;
}

/** Request status as read: a staffed request whose scheduled end has passed is completed. */
export function derivedStatus(stored: RequestStatus, end: Date, now: Date): RequestStatus {
  return stored === "staffed" && end.getTime() <= now.getTime() ? "completed" : stored;
}

/** Status after an accept: staffed when every seat is accepted, partially staffed otherwise. */
export function staffingStatus(accepted: number, total: number): RequestStatus {
  return accepted >= total ? "staffed" : "partially_staffed";
}

/** Status after an approval: invoiced once every seat's timesheet is approved. */
export function billingStatus(approved: number, total: number): RequestStatus {
  return approved >= total ? "invoiced" : "completed";
}

export const DISPATCHABLE: readonly RequestStatus[] = ["submitted", "partially_staffed"];
export const PREP_OPEN: readonly RequestStatus[] = ["draft", "submitted", "partially_staffed", "staffed"];
const CANCELLED: readonly RequestStatus[] = ["cancelled_on_time", "cancelled_late"];
const CANCELLABLE: readonly RequestStatus[] = ["draft", "submitted", "partially_staffed", "staffed"];

export function isCancelled(status: RequestStatus): boolean {
  return CANCELLED.includes(status);
}

/** Edit and submit are draft-only. */
export function assertDraft(status: RequestStatus): void {
  if (status !== "draft") throw new ApiError("invalid_transition", { from: status });
}

/** Cancel (and its quote) is legal from the pre-start states; a started non-draft is refused. */
export function assertCancellable(status: RequestStatus, start: Date, now: Date): void {
  if (!CANCELLABLE.includes(status)) throw new ApiError("invalid_transition", { from: status });
  if (status !== "draft" && start.getTime() <= now.getTime()) throw new ApiError("already_started");
}

interface WindowInput {
  status: RequestStatus;
  start: Date;
  end: Date;
}

interface CancellationWindow {
  late: boolean;
  windowHours: 48 | 72;
  hoursBeforeStart: number;
}

/** The cancellation window: 48 h for requests of 2 h or less, 72 h otherwise; exactly on the edge is on time. */
export function cancellationWindow(request: WindowInput, now: Date): CancellationWindow {
  const long = request.end.getTime() - request.start.getTime() > 2 * HOUR;
  const windowHours = long ? 72 : 48;
  const before = request.start.getTime() - now.getTime();
  const cancellable = CANCELLABLE.includes(request.status) && request.status !== "draft" && before > 0;
  return { late: cancellable && before < windowHours * HOUR, windowHours, hoursBeforeStart: before / HOUR };
}

/** Integer form of a quote, formatted by `quoteJson`. */
export interface QuoteFigures {
  late: boolean;
  windowHours: 48 | 72;
  hoursBeforeStart: number;
  seated: number;
  chargeHundredths: number;
  rateCents: number;
  feePerInterpreterCents: number;
  feeCents: number;
}

/** Late-cancellation fee: per seated interpreter 2 h (short requests) or the scheduled hours, at the current rate. */
export function cancellationQuote(request: WindowInput, seated: number, rateCents: number, now: Date): QuoteFigures {
  const window = cancellationWindow(request, now);
  const chargeHundredths = window.late
    ? window.windowHours === 48
      ? 200
      : scheduledHundredths(request.start, request.end)
    : 0;
  const counted = request.status === "draft" ? 0 : seated;
  const feePerInterpreterCents = amountCents(chargeHundredths, rateCents);
  return { ...window, seated: counted, chargeHundredths, rateCents, feePerInterpreterCents, feeCents: feePerInterpreterCents * counted };
}

export function quoteJson(q: QuoteFigures): Quote {
  const hours = Math.round(q.hoursBeforeStart * 100);
  return {
    late: q.late,
    window_hours: q.windowHours,
    hours_before_start: formatHundredths(hours),
    seated: q.seated,
    charge_hours_per_interpreter: formatHundredths(q.chargeHundredths),
    hourly_rate: formatCents(q.rateCents),
    fee_per_interpreter: formatCents(q.feePerInterpreterCents),
    fee: formatCents(q.feeCents),
  };
}

/** Billed hours: the actual time rounded up to the next quarter hour, never under 2 hours. */
export function billedHundredths(actualStart: Date, actualEnd: Date): number {
  const quarters = Math.ceil((actualEnd.getTime() - actualStart.getTime()) / (15 * MINUTE));
  return Math.max(200, quarters * 25);
}

/** hundredths of an hour × cents per hour, rounded to the cent half up. */
export function amountCents(hundredths: number, rateCents: number): number {
  return Math.trunc((hundredths * rateCents + 50) / 100);
}

/** Credential warning period: a credential expiring within 30 days, and not yet past, is expiring. */
const CREDENTIAL_WARNING_DAYS = 30;

/** The last expiry date inside the warning period that starts `today`. */
export const warningPeriodEnd = (today: string): string => addDays(today, CREDENTIAL_WARNING_DAYS);

/** An expiry date is the credential's last valid day. */
export function credentialStatus(expiresOn: string, today: string): "valid" | "expiring" | "expired" {
  if (expiresOn < today) return "expired";
  return expiresOn <= warningPeriodEnd(today) ? "expiring" : "valid";
}
