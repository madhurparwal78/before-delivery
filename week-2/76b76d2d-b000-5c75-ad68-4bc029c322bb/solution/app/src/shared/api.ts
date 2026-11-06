import type { AuditoriumCode, Cadence, Fare, Locale, Role, SeasonState, Tier } from "./domain.ts";

export type ApiErrorBody = {
  error: { code: string; message: string; fields?: Record<string, string>; seats?: string[]; attempts_left?: number; retry_after_seconds?: number };
};

export type SeasonSummary = {
  slug: string; title: string; title_en: string; title_fr: string; state: SeasonState; public_sale_date: string;
  priority_opens_at: string; public_opens_at: string; first_date: string | null; last_date: string | null; screening_count: number;
};
type SeasonScreening = {
  id: string; film_title: string; format: string; auditorium: AuditoriumCode; starts_at: string; starts_local: string; capacity: number; seats_remaining: number;
};
export type SeasonDetail = SeasonSummary & { screenings: SeasonScreening[] };

export type SeatState = "available" | "held" | "sold" | "mine";
export type ScreeningDetail = {
  id: string; season_slug: string; film_title: string; format: string; auditorium: { code: AuditoriumCode; name: string; venue: string };
  starts_at: string; starts_local: string; capacity: number; sold: number; held: number; seats_remaining: number; seats: { code: string; state: SeatState }[];
};

export type Hold = {
  id: string; screening_id: string; seats: string[]; group: boolean; state: "held" | "expired" | "paid"; ended_by: null | "patron" | "timeout" | "season";
  expires_at: string; server_time: string; booking_ref: string | null;
};

type PriceLine = { fare: Fare; quantity: number; unit_cents: number; subtotal_cents: number; gst_cents: number; qst_cents: number };
type Money = {
  lines: PriceLine[]; admission_cents: number; gst_cents: number; qst_cents: number; uplift_cents: number; total_cents: number; credit_applied_cents: number;
};
export type Quote = Money & { pay_now_cents: number; stepup_required: boolean; currency: "CAD" };

export type Ticket = { code: string; seat: string; fare: Fare; status: "issued" | "checked-in" | "refunded" };
export type Booking = Money & {
  ref: string; state: "held" | "paid" | "checked-in" | "expired" | "refunded"; locale: Locale;
  screening: { id: string; film_title: string; starts_at: string; auditorium: AuditoriumCode };
  seats: string[]; tickets: Ticket[]; paid_cents: number; currency: "CAD"; split: null | { name: string; seats: number; share_cents: number }[]; paid_at: string;
};

export type Membership = {
  tier: Tier; cadence: Cadence | "gift"; plan: string; state: "active"; started_on: string; charged_through: string; ends_on: string | null;
  pending_change: null | { tier: Tier; cadence: Cadence; effective_date: string };
};
export type Invoice = { amount_cents: number; credit_applied_cents: number; paid_cents: number; items: { type: string; description: string; amount_cents: number }[] };

export type Account = {
  number: string | null; name: string; email: string; locale: Locale; role: Role; membership: Membership | null; credit_balance_cents: number;
};
export type CreditMovement = { id: string; kind: "goodwill" | "spend" | "reversal"; amount_cents: number; reference: string; at: string };

export type Refund = { booking_ref: string; refunded_cents: number; recredited_cents: number; currency: "CAD"; state: "refunded" };
export type Gift = { ref: string; tier: Tier; price_cents: number; currency: "CAD"; recipient_name: string; recipient_email: string; state: "unredeemed" | "redeemed"; redeemed_at?: string | null };

export type DoorTicket = { ticket_code: string; seat: string; initial: string; status: Ticket["status"]; booking_ref: string };
export type AuditEntry = { id: number; at: string; actor: string; action: string; target: string; amount_cents: number | null; reason: string };
export type Reconciliation = {
  date: string; timezone: "America/Toronto"; window_start: string; window_end: string;
  local: { admission_cents: number; gst_cents: number; qst_cents: number; uplift_cents: number; gift_cents: number; membership_cents: number; credit_spent_cents: number; refunds_cents: number; net_payments_cents: number };
  killbill: { payments_cents: number; refunds_cents: number; net_payments_cents: number };
  difference_cents: number; status: "matched" | "mismatch" | "accepted"; accepted_difference_cents: number | null;
};
export type OutboxMessage = {
  seq: number; key: string; kind: string; to: string; subject: string; enqueued_at: string; state: "pending" | "sent" | "dead";
  attempts: { started_at: string; finished_at: string | null; outcome: "failed" | "sent" | null }[];
};
export type Enquiry = { ref: string; name: string; email: string; subject: string; message: string; locale: Locale; state: "open" | "answered"; received_at: string };
export type ServiceStatus = { billing: "up" | "down"; mail: "up" | "down"; checked_at: string };
