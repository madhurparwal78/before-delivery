// API objects as the server returns them (brief: API, Objects).

export type Role = "operator" | "member" | "bookkeeper";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  kitchen_id: string;
  member_id: string | null;
}

export type StationKind = "oven" | "mixer" | "chiller" | "prep" | "range" | "kettle" | "cooler";

export interface Station {
  id: string;
  name: string;
  kind: StationKind;
  order: number;
}

export interface Kitchen {
  id: string;
  name: string;
  timezone: string;
  today: string;
  server_now: string;
  same_day_cutoff: string;
  hold_seconds: number;
  stations: Station[];
}

export interface Cell {
  station_id: string;
  start: string;
}

export interface LoomCell extends Cell {
  state: "held" | "booked" | "taken";
  hold_id?: string;
  booking_id?: string;
  expires_at?: string | null;
  business?: string;
}

export interface Loom {
  date: string;
  today: string;
  server_now: string;
  timezone: string;
  same_day_cutoff: string;
  hold_seconds: number;
  covered_until: string | null;
  papers: boolean;
  stations: Station[];
  cells: LoomCell[];
}

export interface Line {
  station_id: string;
  station: string;
  tier: number;
  paid_by: "cash" | "pack";
  quarters: number;
  hours: string;
  hourly_rate_cents: number;
  amount_cents: number;
}

export interface PackLine {
  description: string;
  amount_cents: number;
}

export interface Quote {
  month: string;
  month_hours_before: string;
  rate_card_id: string;
  lines: Line[];
  tier_steps_crossed: number[];
  pack_quarters: number;
  quarters: number;
  hours: string;
  total_cents: number;
  total: string;
}

export interface Hold {
  id: string;
  member_id: string;
  date: string;
  state: "held" | "expired" | "released" | "confirmed";
  cells: Cell[];
  expires_at: string;
  expires_local: string;
  server_now: string;
  quote: Quote;
}

export type BookingState = "confirmed" | "checked_in" | "completed" | "no_show" | "cancelled_in_window" | "cancelled_late";

export interface Booking {
  id: string;
  ref: string;
  member_id: string;
  kitchen_id: string;
  date: string;
  state: BookingState;
  cells: Cell[];
  blocks: { station_id: string; station: string; start: string; end: string; hours: string }[];
  starts_at: string;
  ends_at: string;
  quarters: number;
  hours: string;
  lines: Line[];
  pack_quarters: number;
  total_cents: number;
  total: string;
  rate_card_id: string;
  cancellation_window_hours: number;
  confirmed_at: string;
  invoice_id: string | null;
  series_id: string | null;
}

export interface Invoice {
  id: string;
  ref: string;
  member_id: string;
  kind: "booking" | "series" | "pack";
  booking_ids: string[];
  lines: (Line | PackLine)[];
  total_cents: number;
  total: string;
  killbill_invoice_id: string | null;
  billing_amount_cents: number | null;
  issued_at: string;
}

export type DocumentType = "insurance" | "food_handler" | "kitchen_agreement";

export interface PaperDocument {
  id: string;
  member_id: string;
  type: DocumentType;
  label: string;
  state: "uploaded" | "verified" | "rejected" | "expiring" | "expired";
  expires_on: string | null;
  original_name: string;
  size_bytes: number;
  content_type: string;
  uploaded_at: string;
  reject_reason: string | null;
}

export interface Movement {
  id: string;
  kind: "purchase" | "draw" | "refund";
  quarters: number;
  booking_id: string | null;
  reverses: string | null;
  created_at: string;
  entries: { account: string; quarters: number }[];
}

export interface Pack {
  balance_quarters: number;
  balance_hours: string;
  movements: Movement[];
}

export interface MemberSummary {
  id: string;
  business: string;
  contact_email: string;
  covered_until: string | null;
  month_hours: string;
  pack_balance_quarters: number;
}

export interface RateCard {
  id: string;
  effective_from: string;
  tier_rates_cents: number[];
  station_surcharges_cents: Record<string, number>;
  cancellation_window_hours: number;
  pack_price_cents: number;
  in_force: boolean;
  created_at: string;
}

export interface SeriesQuote {
  occurrences: { date: string; starts_at: string; ends_at: string; quote: Quote }[];
  total_cents: number;
  total: string;
}

export interface UsageReport {
  kitchen: { id: string; name: string; timezone: string };
  month: string;
  members: {
    member_id: string;
    business: string;
    booked_hours: string;
    cancelled_in_window_hours: string;
    billed_cents: number;
    refunded_cents: number;
    pack_balance_hours: string;
  }[];
  stations: { station_id: string; name: string; booked_hours: string }[];
  invoices: {
    invoice_id: string;
    ref: string;
    kind: string;
    member_id: string;
    business: string;
    killbill_invoice_id: string | null;
    total_cents: number;
    issued_on: string;
  }[];
  totals: { booked_hours: string; billed_cents: number; refunded_cents: number };
}

export interface ServiceStatus {
  services: { billing: "up" | "down"; files: "up" | "down"; mail: "up" | "down" };
  paused: string[];
}
