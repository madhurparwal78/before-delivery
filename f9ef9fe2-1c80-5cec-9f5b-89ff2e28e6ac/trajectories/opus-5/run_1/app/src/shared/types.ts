/** API object shapes, shared by the server and the browser app. */

export type Role = 'operator' | 'member' | 'bookkeeper';

export type StationKind = 'oven' | 'mixer' | 'chiller' | 'prep' | 'range' | 'kettle' | 'cooler';

export type BookingState =
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'no_show'
  | 'cancelled_in_window'
  | 'cancelled_late';

export type HoldState = 'held' | 'expired' | 'released' | 'confirmed';

export type DocumentType = 'insurance' | 'food_handler' | 'kitchen_agreement';

export type DocumentState = 'uploaded' | 'verified' | 'rejected' | 'expiring' | 'expired';

export type MovementKind = 'purchase' | 'draw' | 'refund';

export type PackAccount = 'member_pack' | 'pack_sales' | 'hours_used';

export type ServiceName = 'billing' | 'files' | 'mail';

export type ServiceHealth = 'up' | 'down';

export type PausedAction =
  | 'confirm_booking'
  | 'create_series'
  | 'cancel_booking'
  | 'buy_pack'
  | 'upload_document'
  | 'view_document';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  kitchen_id: string;
  member_id: string | null;
}

export interface Station {
  id: string;
  name: string;
  kind: StationKind;
  order: number;
}

export interface Cell {
  station_id: string;
  start: string;
}

export interface Line {
  station_id: string;
  station: string;
  tier: 1 | 2 | 3 | 4;
  paid_by: 'cash' | 'pack';
  quarters: number;
  hours: string;
  hourly_rate_cents: number;
  amount_cents: number;
}

export interface DescriptionLine {
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
  state: HoldState;
  cells: Cell[];
  expires_at: string;
  expires_local: string;
  server_now: string;
  quote: Quote;
}

export interface BookingBlock {
  station_id: string;
  station: string;
  start: string;
  end: string;
  hours: string;
}

export interface Booking {
  id: string;
  ref: string;
  member_id: string;
  kitchen_id: string;
  date: string;
  state: BookingState;
  cells: Cell[];
  blocks: BookingBlock[];
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
  business?: string;
}

export interface Invoice {
  id: string;
  ref: string;
  member_id: string;
  kind: 'booking' | 'series' | 'pack';
  booking_ids: string[];
  lines: (Line | DescriptionLine)[];
  total_cents: number;
  total: string;
  killbill_invoice_id: string | null;
  billing_amount_cents: number | null;
  issued_at: string;
}

export interface ComplianceDocument {
  id: string;
  member_id: string;
  type: DocumentType;
  label: string;
  state: DocumentState;
  expires_on: string | null;
  original_name: string;
  size_bytes: number;
  content_type: string;
  uploaded_at: string;
  reject_reason: string | null;
  business?: string;
}

export interface MovementEntry {
  account: PackAccount;
  quarters: number;
}

export interface Movement {
  id: string;
  kind: MovementKind;
  quarters: number;
  booking_id: string | null;
  reverses: string | null;
  created_at: string;
  entries: MovementEntry[];
}

export interface MemberSummary {
  id: string;
  business: string;
  contact_email: string;
  covered_until: string | null;
  month_hours: string;
  pack_balance_quarters: number;
}

export interface Kitchen {
  id: string;
  name: string;
  timezone: string;
  today: string;
  server_now: string;
  same_day_cutoff: string;
  hold_seconds: number;
  cancellation_window_hours: number;
  stations: Station[];
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

export interface LoomCell {
  station_id: string;
  start: string;
  state: 'held' | 'booked' | 'taken';
  hold_id?: string;
  booking_id?: string;
  expires_at?: string;
  business?: string;
}

export interface LoomView {
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

export interface StatusView {
  services: Record<ServiceName, ServiceHealth>;
  paused: PausedAction[];
}

export interface SeriesOccurrence {
  date: string;
  starts_at: string;
  ends_at: string;
  quote: Quote;
}

export interface Series {
  id: string;
  weekday: number;
  start: string;
  end: string;
  station_ids: string[];
  weeks: number;
  booking_ids: string[];
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

export interface ApiError {
  error: string;
  message: string;
  errors?: Record<string, string>;
  taken?: Cell[];
  quote?: Quote;
  state?: string;
  from?: string;
  to?: string;
  dates?: string[];
}

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  insurance: 'Insurance certificate',
  food_handler: 'Food-handler card',
  kitchen_agreement: 'Signed kitchen-use agreement',
};

/** The loom runs from 04:00 to 24:00 kitchen time in quarter-hour columns. */
export const LOOM_START_MINUTE = 4 * 60;
export const LOOM_END_MINUTE = 24 * 60;
export const LOOM_COLUMNS = (LOOM_END_MINUTE - LOOM_START_MINUTE) / 15;
