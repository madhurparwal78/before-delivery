// Domain shapes shared by the server modules, named as the brief names them.

export type Role = "operator" | "member" | "bookkeeper";
export type StationKind = "oven" | "mixer" | "chiller" | "prep" | "range" | "kettle" | "cooler";
export type Tier = 1 | 2 | 3 | 4;
export type PaidBy = "cash" | "pack";
export type BookingState =
  | "confirmed"
  | "checked_in"
  | "completed"
  | "no_show"
  | "cancelled_in_window"
  | "cancelled_late";
type StoredHoldState = "held" | "released" | "confirmed";
export type HoldState = StoredHoldState | "expired";
export type DocumentType = "insurance" | "food_handler" | "kitchen_agreement";
type StoredDocumentState = "uploaded" | "verified" | "rejected";
export type DocumentState = StoredDocumentState | "expiring" | "expired";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  kitchen_id: string;
  member_id: string | null;
}

export interface Kitchen {
  id: string;
  name: string;
  timezone: string;
  same_day_cutoff: string;
}

export interface Station {
  id: string;
  name: string;
  kind: StationKind;
  order: number;
}

export interface Member {
  id: string;
  kitchen_id: string;
  business: string;
  contact_email: string;
  killbill_account_id: string | null;
}

export interface Cell {
  station_id: string;
  start: string;
}

export interface RateCard {
  id: string;
  kitchen_id: string;
  effective_from: string;
  tier_rates_cents: number[];
  station_surcharges_cents: Record<string, number>;
  cancellation_window_hours: number;
  pack_price_cents: number;
  created_at: Date;
}

export interface Line {
  station_id: string;
  station: string;
  tier: Tier;
  paid_by: PaidBy;
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

export interface HoldRow {
  id: string;
  kitchen_id: string;
  member_id: string;
  date: string;
  cells: Cell[];
  state: StoredHoldState;
  created_at: Date;
  expires_at: Date;
}

export interface BookingRow {
  id: string;
  ref: string;
  kitchen_id: string;
  member_id: string;
  hold_id: string | null;
  series_id: string | null;
  date: string;
  state: BookingState;
  cells: Cell[];
  starts_at: Date;
  ends_at: Date;
  quarters: number;
  lines: Line[];
  pack_quarters: number;
  total_cents: number;
  rate_card_id: string;
  cancellation_window_hours: number;
  confirmed_at: Date;
  invoice_id: string | null;
  refund_cents: number;
  cancelled_at: Date | null;
}

export interface InvoiceRow {
  id: string;
  ref: string;
  kitchen_id: string;
  member_id: string;
  kind: "booking" | "series" | "pack";
  booking_ids: string[];
  lines: (Line | PackLine)[];
  total_cents: number;
  killbill_invoice_id: string | null;
  issued_at: Date;
}

export interface DocumentRow {
  id: string;
  kitchen_id: string;
  member_id: string;
  type: DocumentType;
  state: StoredDocumentState;
  expires_on: string | null;
  original_name: string;
  size_bytes: number;
  content_type: string;
  uploaded_at: Date;
  reject_reason: string | null;
  file_stored: boolean;
}

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  insurance: "Insurance certificate",
  food_handler: "Food-handler card",
  kitchen_agreement: "Signed kitchen-use agreement",
};

/** Booking states whose cells stay taken. */
export const OCCUPYING_STATES: BookingState[] = ["confirmed", "checked_in", "completed", "no_show"];
/** Booking states whose quarters count toward the monthly tiers. */
export const TIER_COUNTING_STATES: BookingState[] = [...OCCUPYING_STATES, "cancelled_late"];

export const FIRST_CELL_MINUTES = 4 * 60;
export const LAST_CELL_MINUTES = 23 * 60 + 45;
export const PACK_QUARTERS = 80;
export const HORIZON_DAYS = 365;
export const MAX_CELLS = 320;
