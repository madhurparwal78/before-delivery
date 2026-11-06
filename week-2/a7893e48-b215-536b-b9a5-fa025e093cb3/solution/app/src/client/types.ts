export type Role = "renter" | "front_desk" | "manager";

export interface User { id: string; name: string; email: string; role: Role; operator_id: string; site_ids: string[]; renter_id: string | null }

export interface Station { id: string; name: string; rate_cents: number }
export interface Site { id: string; name: string; time_zone: string; deposit_cents: number; cleaning_fee_cents: number; stations: Station[] }

export type SegmentState = "booked" | "held" | "yours_booked" | "yours_held";
export interface Segment { start_at: string; end_at: string; state: SegmentState; label: string; booking_id: string | null; hold_id: string | null; renter_business: string | null }
export interface DayStation extends Station { segments: Segment[] }
export interface Tick { at: string; label: string; zone: string }
export interface DayView { site_id: string; date: string; time_zone: string; hours: number; ticks: Tick[]; pack_minutes_available: number | null; stations: DayStation[] }

export interface Occurrence { date: string; start: string; end: string; start_at: string; end_at: string; minutes: number; local_start: string; local_end: string; due_by: string }
export interface Quote { pack_minutes_available: number; pack_minutes: number; card_minutes: number; card_cents: number; deposit_cents: number }
export interface Hold {
  id: string; status: "held" | "expired" | "confirmed"; station_id: string; site_id: string; renter_id: string;
  created_at: string; expires_at: string; occurrences: Occurrence[]; quote: Quote; terms: string;
}

export type BookingStatus = "confirmed" | "checked_in" | "overrun_billed" | "checked_out" | "settled" | "cancelled_refunded" | "cancelled_forfeit" | "unpaid_cancelled";
export interface Refund { tier: "full" | "none"; pack_minutes_returned: number; card_refund_cents: number; deposit_refund_cents: number }
export interface Booking {
  id: string; hold_id: string | null; site_id: string; station_id: string; station_name: string; renter_id: string; renter_business: string;
  status: BookingStatus; start_at: string; end_at: string; local_start: string; local_end: string; local_date: string; minutes: number;
  pack_minutes: number; card_minutes: number; card_cents: number; deposit_cents: number; paid: boolean; balance_due_cents: number;
  balance_due_by: string | null; policy: { version_id: string; notice_hours: number; effective_from: string }; confirmed_at: string;
  checked_in_at: string | null; checked_out_at: string | null; overrun_minutes: number | null; overrun_cents: number | null;
  cleaning_fee_cents: number | null; terms: string; cancel_tier: "full" | "none";
  refund: Omit<Refund, "tier">;
}

export interface InvoiceLine { description: string; minutes: number | null; amount_cents: number }
export interface Invoice { booking_id: string; renter_business: string; site_name: string; lines: InvoiceLine[]; total_cents: number; paid_cents: number; refunded_cents: number; balance_due_cents: number; terms: string }
export interface AuditEvent { at: string; actor_name: string; actor_role: string; action: string; from: string | null; to: string | null; reason: string | null }

export interface LedgerEntry { id: string; movement_id: string; account: string; minutes: number; reason: string; booking_id: string | null; pack_id: string | null; created_at: string }
export interface Pack { available_minutes: number; reserved_minutes: number; used_minutes: number; entries: LedgerEntry[] }

export interface DocumentRecord { id: string; kind: "liability" | "food_handler"; valid_from: string; expires_on: string; content_type: string; size_bytes: number; uploaded_at: string; status: "current" | "expiring" | "expired" | "not_yet_valid"; days_left: number }

export interface ServiceStatus { billing: "ok" | "delayed"; mail: "ok" | "delayed"; queued_emails: number }

export interface Renter { id: string; name: string; business: string; email: string; home_site_id: string }
export interface SiteTotals { site_id: string; name: string; local_date: string; bookings_today: number; booked_minutes_today: number; unpaid_balance_cents: number; expiring_documents: number }
export interface Dashboard { sites: SiteTotals[]; totals: Omit<SiteTotals, "site_id" | "name" | "local_date"> }
export interface Utilisation { site_id: string; date: string; time_zone: string; day_minutes: number; stations: { station_id: string; name: string; booked_minutes: number; utilisation_percent: number }[] }
export interface PolicyVersion { id: string; notice_hours: number; effective_from: string; effective_at: string; created_by_name: string; created_at: string }
export interface BinderLink { id: string; site_id: string; from: string; to: string; url: string; expires_at: string; revoked: boolean; created_at: string }
