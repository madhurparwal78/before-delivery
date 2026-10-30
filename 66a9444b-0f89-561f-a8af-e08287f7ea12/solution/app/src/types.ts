// The API's shapes, as the browser reads them (brief: API — Shared objects).
export type Role = "visitor" | "group_booker" | "artist" | "curator" | "box_office" | "finance" | "admin";
export type User = { id: string; email: string; name: string; role: Role; organisation_id: string | null };

export type Session = {
  id: string; title: string; description: string; discipline: string; venue_id: string; admission: "pass" | "seat";
  capacity: number | null; seats_remaining: number | null; price_full_cents: number | null; price_reduced_cents: number | null;
  starts_at: string; ends_at: string; starts_local: string; ends_local: string; festival_day: string; status: string;
  publish_at?: string | null; version?: number;
};
type FestivalDay = { date: string; label: string; starts_at: string; ends_at: string };
export type Named = { id: string; name: string };
type PricePolicy = { full_festival_full_cents: number; full_festival_reduced_cents: number; day_full_cents: number; day_reduced_cents: number; group_discount_percent: number };
export type Programme = {
  edition: { name: string; first_day: string; last_day: string; time_zone: string };
  festival_days: FestivalDay[]; venues: Named[]; disciplines: Named[]; sessions: Session[]; price_policy: PricePolicy;
};

export type Hold = { id: string; session_id: string; quantity: number; expires_at: string; status: string };
export type Pass = { code: string; status: string };
export type Line = {
  id: string; position: number; kind: "seat" | "full_festival" | "day"; session_id: string | null; festival_day: string | null; title: string;
  holder_name: string; state: string; list_cents: number; group_discount_cents: number; voucher_cents: number; charged_cents: number; pass: Pass | null;
};
export type Refund = { id: string; order_id: string; line_ids: string[]; card_cents: number; voucher_cents: number; credit_note_id: string | null; status: string; reason: string; created_at: string };
export type Order = {
  id: string; ref: string; buyer_name: string; organisation_id: string | null; rate: "full" | "reduced"; status: string;
  subtotal_cents: number; group_discount_cents: number; voucher_code: string | null; voucher_cents: number; total_cents: number;
  proof_deadline: string | null; confirmation_mail: "sent" | "pending"; invoice_id: string | null; created_at: string; lines: Line[]; refunds: Refund[];
};
export type WaitlistEntry = { id: string; session_id: string; title: string; position: number | null; status: string; offer_expires_at: string | null };
export type Entry = {
  id: string; artist_id: string; artist_name: string; title: string; statement: string; discipline: string; medium: string; year: number;
  status: string; publish_at: string | null; images: { id: string; width: number; height: number; display_url: string | null }[];
};
export type Proof = { id: string; order_id: string; order_ref: string; kind: string; status: string; uploaded_at: string; deadline: string; content_type: string; size_bytes: number; buyer_name?: string };
export type Invoice = {
  id: string; number: string; organisation_id: string; order_id: string; status: string; amount_cents: number; credited_cents: number;
  paid_cents: number; balance_cents: number; issued_at: string; due_at: string; retries_used: number; next_retry_at: string | null;
  credit_note_ids: string[]; lines: { line_id: string; description: string; amount_cents: number }[];
};
export type CreditNote = { id: string; number: string; invoice_id: string; amount_cents: number; issued_at: string; lines: { line_id: string; description: string; amount_cents: number }[] };
export type Mismatch = {
  id: string; run_id: string; type: string; order_ref: string | null; killbill_transaction_id: string | null; transaction_type: string;
  app_amount_cents: number | null; killbill_amount_cents: number | null; status: "open" | "resolved"; note: string | null; resolved_by: string | null; resolved_at: string | null;
};
export type AuditEntry = { id: string; at: string; actor: string; actor_role: string; action: string; target_type: string; target_id: string; detail: Record<string, unknown> };
