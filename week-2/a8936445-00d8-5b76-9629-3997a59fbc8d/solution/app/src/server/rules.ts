// Every domain rule of the brief's Business rules, each defined once and called by every surface.
import {
  CHECK_IN_EARLY_MINUTES,
  CLEANING_BUFFER_MINUTES,
  DAY_MINUTES,
  HOLDOVER_GRACE_MINUTES,
  HOLDOVER_STEP_MINUTES,
  REMINDER_LEAD_DAYS,
  REQUIRED_KINDS,
  type BookingStatus,
  type DocumentKind,
  type DocumentStatus,
  type TenantStatus,
} from "../shared/kitchen";
import { feeRefundable, roundHalfUp } from "../shared/charges";
import { addDays } from "../shared/time";
import { ApiError, invalidTransition } from "./errors";

/* ---------- Booking state transitions (brief: Booking states) ---------- */

export type BookingEvent = "confirm" | "check_in" | "check_out" | "cancel" | "no_show";

const BOOKING_EDGES: Record<BookingEvent, { from: BookingStatus; to: BookingStatus }> = {
  confirm: { from: "held", to: "confirmed" },
  check_in: { from: "confirmed", to: "checked_in" },
  check_out: { from: "checked_in", to: "completed" },
  cancel: { from: "confirmed", to: "cancelled" },
  no_show: { from: "confirmed", to: "no_show" },
};

/** The status a booking moves to on an event, or 409 invalid_transition. */
export function bookingTransition(status: BookingStatus, event: BookingEvent): BookingStatus {
  const edge = BOOKING_EDGES[event];
  if (edge.from !== status) throw invalidTransition();
  return edge.to;
}

/* ---------- Hold expiry (brief: Hold life) ---------- */

/** A hold is live from creation until expires_at; from that instant it is gone. */
export function holdIsLive(hold: { confirmed_at: Date | null; expires_at: Date }, nowMs: number): boolean {
  return hold.confirmed_at === null && nowMs < hold.expires_at.getTime();
}

/** Live holds and confirmed, checked-in or completed bookings take their station's time. */
export function occupiesStation(status: BookingStatus, hold: { confirmed_at: Date | null; expires_at: Date }, nowMs: number): boolean {
  return status === "held" ? holdIsLive(hold, nowMs) : ["confirmed", "checked_in", "completed"].includes(status);
}

/* ---------- Free slots and the cleaning buffer (brief: Hold placement) ---------- */

export interface StationBlock {
  tenantId: string;
  start: number;
  end: number;
}

/** True when a candidate occurrence overlaps a block, or sits within the buffer of another tenant's block. */
export function slotTaken(candidate: StationBlock, blocks: StationBlock[]): boolean {
  return blocks.some((block) => {
    const gap = block.tenantId === candidate.tenantId ? 0 : CLEANING_BUFFER_MINUTES;
    return candidate.start < block.end + gap && block.start < candidate.end + gap;
  });
}

/** Cleaning blocks: the 30 minutes after each run of one tenant's touching blocks, cut at 24:00 and at the next block. */
export function cleaningBlocks(blocks: StationBlock[]): { start: number; end: number }[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const cleaning: { start: number; end: number }[] = [];
  sorted.forEach((block, index) => {
    const next = sorted[index + 1];
    if (next && next.tenantId === block.tenantId && next.start === block.end) return;
    const end = Math.min(block.end + CLEANING_BUFFER_MINUTES, DAY_MINUTES, next ? next.start : DAY_MINUTES);
    if (end > block.end) cleaning.push({ start: block.end, end });
  });
  return cleaning;
}

/* ---------- Money for station time and hold-over ---------- */

export function stationTimeCents(elapsedMinutes: number, hourlyRateCents: number): number {
  return roundHalfUp(elapsedMinutes * hourlyRateCents, 60);
}

/** Billed hold-over minutes from the cook's report (brief: Hold-over). */
export function billedHoldoverMinutes(reportedMinutes: number): number {
  if (reportedMinutes <= HOLDOVER_GRACE_MINUTES) return 0;
  return Math.ceil(reportedMinutes / HOLDOVER_STEP_MINUTES) * HOLDOVER_STEP_MINUTES;
}

/* ---------- Check-in window, no-show and cancellation timing ---------- */

export function checkInWindowOpen(startMs: number, endMs: number, nowMs: number): boolean {
  return nowMs >= startMs - CHECK_IN_EARLY_MINUTES * 60_000 && nowMs < endMs;
}

/* ---------- Fee refunds (brief: Cancellation charges) ---------- */

/** A late fee may be refunded once, while it is above zero and not on an invoice. */
export function assertFeeRefundable(booking: {
  status: BookingStatus;
  fee_cents: number | null;
  fee_minutes: number | null;
  fee_refunded: boolean | null;
  fee_invoice_id: string | null;
}): void {
  const refundable = feeRefundable({
    cancelled: booking.status === "cancelled",
    feeCents: booking.fee_cents ?? 0,
    feeMinutes: booking.fee_minutes ?? 0,
    refunded: Boolean(booking.fee_refunded),
  });
  if (!refundable) throw invalidTransition();
  if (booking.fee_invoice_id) throw new ApiError(409, "fee_invoiced", "That fee is already refunded or invoiced.");
}

/* ---------- Document validity and tenant status (brief: Validity edge, Tenant lifecycle) ---------- */

export interface DocumentFacts {
  kind: DocumentKind;
  status: DocumentStatus;
  expires_on: string;
  holder_name: string | null;
}

/** An approved document counts through the end of its expiry day in kitchen time. */
export function documentValid(doc: DocumentFacts, today: string): boolean {
  return doc.status === "approved" && doc.expires_on >= today;
}

export type RequiredDocuments = Record<DocumentKind, { valid: boolean; expires_on: string | null }>;

export function requiredDocuments(docs: DocumentFacts[], today: string): RequiredDocuments {
  const result = {} as RequiredDocuments;
  for (const kind of REQUIRED_KINDS) {
    const approved = docs.filter((d) => d.kind === kind && d.status === "approved");
    const latest = approved.reduce<string | null>((max, d) => (max === null || d.expires_on > max ? d.expires_on : max), null);
    result[kind] = { valid: approved.some((d) => documentValid(d, today)), expires_on: latest };
  }
  return result;
}

export type Lifecycle = "applied" | "documents_review" | "active" | "offboarded";

/** An admitted tenant is active while every required kind is valid, otherwise suspended. */
export function tenantStatus(lifecycle: Lifecycle, required: RequiredDocuments): TenantStatus {
  if (lifecycle !== "active") return lifecycle;
  return REQUIRED_KINDS.every((kind) => required[kind].valid) ? "active" : "suspended";
}

export function missingKinds(required: RequiredDocuments): DocumentKind[] {
  return REQUIRED_KINDS.filter((kind) => !required[kind].valid);
}

/** Kinds whose validity edge (00:00 after the latest expiry) falls before an occurrence on `date` ends. */
export function kindsExpiringBefore(date: string, required: RequiredDocuments): DocumentKind[] {
  return REQUIRED_KINDS.filter((kind) => {
    const latest = required[kind].expires_on;
    return latest === null || date > latest;
  });
}

/** An approved document is reminded once inside the lead window, unless a later one of its kind (and holder) exists. */
export function reminderDue(doc: DocumentFacts, others: DocumentFacts[], today: string): boolean {
  if (doc.status !== "approved" || today < addDays(doc.expires_on, -REMINDER_LEAD_DAYS) || today > doc.expires_on) return false;
  return !others.some(
    (other) =>
      other !== doc &&
      other.status === "approved" &&
      other.kind === doc.kind &&
      (doc.kind !== "food_handler_card" || other.holder_name === doc.holder_name) &&
      other.expires_on > doc.expires_on,
  );
}

/** The inspector's current set: latest valid certificate, latest valid permit, latest valid card per holder. */
export function currentDocuments<T extends DocumentFacts>(docs: T[], today: string): T[] {
  const best = new Map<string, T>();
  for (const doc of docs) {
    if (!documentValid(doc, today)) continue;
    const slot = doc.kind === "food_handler_card" ? `${doc.kind}:${doc.holder_name}` : doc.kind;
    const held = best.get(slot);
    if (!held || doc.expires_on > held.expires_on) best.set(slot, doc);
  }
  return [...best.values()];
}

/* ---------- Invoice totals and tax (brief: Invoices) ---------- */

export function taxRatePercent(basisPoints: number): string {
  return `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}`;
}

export function invoiceTotals(lineAmounts: number[], taxBasisPoints: number): { subtotal: number; tax: number; total: number } {
  const subtotal = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  const tax = roundHalfUp(subtotal * taxBasisPoints, 10_000);
  return { subtotal, tax, total: subtotal + tax };
}
