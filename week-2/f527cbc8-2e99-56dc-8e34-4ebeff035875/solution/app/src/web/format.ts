// How values print in the interface (brief: Visual design, Units and precision; Feedback states, placeholders).
// Instants arrive already carrying the practice-zone offset, so wall-clock text is read straight from the string and
// the device clock and zone never enter it.
import type { BookingStatus, DayStatus, DunningState, Hoof, Invoice, VisitStatus, WorkCode } from "./api";
export { dollars } from "../shared/money";

/** `YYYY-MM-DD HH:MM (<time zone>)` for an instant printed by the API. */
export const wallClock = (instant: string, zone: string): string => `${instant.slice(0, 10)} ${instant.slice(11, 16)} (${zone})`;

/** `HH:MM:SS` of an API instant, in the practice zone it already carries. */
export const clockSeconds = (instant: string): string => instant.slice(11, 19);

export const degrees = (angle: number): string => `${angle.toFixed(1)}°`;

/** Parses a dollar amount like `45` or `45.00` into cents; null when it is not one. */
export function parseDollars(text: string): number | null {
  const match = /^\s*\$?(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export const centsToDollarText = (cents: number): string => (cents / 100).toFixed(2);

export const HOOF_NAMES: Record<Hoof, string> = { LF: "Left fore", RF: "Right fore", LH: "Left hind", RH: "Right hind" };
export const HOOVES: Hoof[] = ["LF", "RF", "LH", "RH"];
export const isHoof = (value: string | null): value is Hoof => value !== null && (HOOVES as string[]).includes(value);

export const SERVICE_NAMES: Record<WorkCode, string> = {
  trim: "Trim",
  front_reset: "Front shoes, reset",
  full_reset: "Full set, reset",
  front_new: "Front shoes, new",
  full_new: "Full set, new",
};
export const WORK_CODES = Object.keys(SERVICE_NAMES) as WorkCode[];

/** The three published test cards, in picker order (brief: Public screens, Card picker). */
export const CARDS = [
  { token: "tok_approve_4242", label: "Test card 4242 (approves)" },
  { token: "tok_decline_0002", label: "Test card 0002 (declines)" },
  { token: "tok_funds_9995", label: "Test card 9995 (insufficient funds)" },
] as const;

export const BOOKING_LABELS: Record<BookingStatus, string> = {
  held: "Held",
  confirmed: "Confirmed",
  cancelled_in_time: "Cancelled in time",
  cancelled_late: "Cancelled late",
  worked: "Worked",
  no_show: "No-show",
  excused: "Excused",
};

export const DAY_LABELS: Record<DayStatus, string> = {
  draft: "Draft",
  published: "Published",
  full: "Full",
  in_progress: "In progress",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const ROLE_LABELS = { farrier: "Farrier", apprentice: "Apprentice", owner: "Owner", barn_manager: "Barn manager" } as const;

export const DUNNING_LABELS: Record<DunningState, string> = {
  none: "",
  past_due: "Past due",
  retry_1: "Retry 1",
  retry_2: "Retry 2",
  blocked: "Blocked",
  cleared: "Cleared",
};

export const INVOICE_LABELS = { pending: "Pending", unpaid: "Unpaid", paid: "Paid" } as const;

/** The visit status text of the day sheet and visit list (brief: Public screens, Visit status). */
export function visitStatusText(status: VisitStatus, hasInvoice: boolean): string {
  if (status === "invoice_pending" || status === "closed") return "Invoice pending";
  if (status === "invoiced") return hasInvoice ? "Invoiced" : "Billed before Clinchline";
  return "Open";
}

/** The same text for a trip-only invoice on a cancelled-late or no-show row. */
export const tripInvoiceText = (invoice: Pick<Invoice, "status">): string => (invoice.status === "pending" ? "Invoice pending" : "Invoiced");
