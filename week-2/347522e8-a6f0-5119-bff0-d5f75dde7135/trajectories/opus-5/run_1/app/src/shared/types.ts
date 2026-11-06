/** The JSON shapes the API sends and the browser reads. */

export type Role = 'operator' | 'shift_lead' | 'renter';

export type RenterStatus =
  | 'applied'
  | 'documents_review'
  | 'active'
  | 'suspended'
  | 'offboarded';

export type DocumentKind = 'coi' | 'food_handler_card' | 'business_licence';
export type DocumentStatus = 'pending_review' | 'approved' | 'rejected';

export type BookingStatus =
  | 'hold'
  | 'confirmed'
  | 'expired'
  | 'displaced'
  | 'cancelled'
  | 'checked_in'
  | 'completed';

export type ComplianceState = 'current' | 'expiring' | 'lapsed' | 'incomplete';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  renter_id: string | null;
  renter_status: RenterStatus | null;
}

export interface Compliance {
  state: ComplianceState;
  coi_expires_on: string | null;
  card_expires_on: string | null;
}

export interface ShelfSubscription {
  shelf_label: string;
  plan: 'walk-in-shelf-monthly';
  external_key: string;
  killbill_subscription_id: string;
  state: 'active' | 'cancelled';
  billing_state: 'ACTIVE' | 'CANCELLED' | 'unknown';
}

export interface RenterSummary {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  status: RenterStatus;
  balance_minutes: number;
  held_minutes: number;
  compliance: Compliance;
}

export interface Renter extends RenterSummary {
  shelf_subscription: ShelfSubscription | null;
}

export interface ComplianceDocument {
  id: string;
  renter_id: string;
  kind: DocumentKind;
  expires_on: string | null;
  status: DocumentStatus;
  original_name: string;
  size_bytes: number;
  content_type: string;
  created_at: string;
}

export interface Pack {
  id: string;
  name: string;
  hours: number;
  amount_usd: string;
}

export interface PacksResponse {
  packs: Pack[];
  purchases_available: boolean;
}

export interface Purchase {
  id: string;
  pack_id: string;
  pack_name: string;
  hours: number;
  amount_usd: string;
  killbill_payment_id: string;
  created_at: string;
}

export type MovementKind =
  | 'opening_balance'
  | 'pack_purchase'
  | 'booking_hold'
  | 'hold_release'
  | 'cancellation_credit'
  | 'displacement_credit'
  | 'checkout'
  | 'cancellation_forfeit'
  | 'adjustment';

export interface LedgerEntry {
  id: string;
  movement_id: string;
  kind: MovementKind;
  account: string;
  direction: 'debit' | 'credit';
  minutes: number;
  booking_id: string | null;
  purchase_id: string | null;
  note: string | null;
  created_at: string;
}

export interface LedgerResponse {
  balance_minutes: number;
  held_minutes: number;
  entries: LedgerEntry[];
}

export interface StationSettings {
  station_id: string;
  effective_from: string;
  hour_weight: number;
  off_peak_percent: number;
  overage_usd_per_hour: string;
  buffer_minutes: number;
}

export type BlockKind = 'booking' | 'hold' | 'maintenance';

export interface StationBlock {
  kind: BlockKind;
  start: string;
  end: string;
  starts_at: string;
  ends_at: string;
  buffer_ends_at: string;
  mine: boolean;
  booking_id: string | null;
  renter_business_name: string | null;
}

export interface Station {
  id: string;
  name: string;
  hour_weight: number;
  off_peak_percent: number;
  overage_usd_per_hour: string;
  buffer_minutes: number;
  upcoming_settings: StationSettings[];
  blocks: StationBlock[];
}

export interface StationsResponse {
  date: string;
  time_zone: string;
  server_now: string;
  stations: Station[];
}

export interface Booking {
  id: string;
  series_id: string;
  station_id: string;
  station_name: string;
  renter_id: string;
  status: BookingStatus;
  date: string;
  start: string;
  end: string;
  starts_at: string;
  ends_at: string;
  buffer_minutes: number;
  buffer_ends_at: string;
  hour_weight: number;
  off_peak_percent: number;
  overage_usd_per_hour: string;
  minutes_debited: number;
  hold_expires_at: string | null;
  cancellation_cutoff_at: string;
  actual_start: string | null;
  actual_end: string | null;
  overage_units: number | null;
  overage_usd: string | null;
  created_at: string;
}

export interface BookingsResponse {
  server_now: string;
  bookings: Booking[];
}

export interface UsageSheetRow {
  booking_id: string;
  station_name: string;
  renter_business_name: string;
  start: string;
  end: string;
  actual_start: string | null;
  actual_end: string | null;
  status: BookingStatus;
  overage_units: number | null;
  overage_usd: string | null;
}

export interface UsageSheetResponse {
  date: string;
  time_zone: string;
  server_now: string;
  rows: UsageSheetRow[];
}

export interface Statement {
  id: string;
  renter_id: string;
  month: string;
  created_at: string;
}

export interface ComplianceLink {
  id: string;
  label: string;
  token: string;
  url: string;
  expires_in_seconds: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: 'queued' | 'sent';
  attempts: number;
  created_at: string;
  sent_at: string | null;
}

export interface ShareDocument {
  id: string;
  kind: DocumentKind;
  label: string;
  expires_on: string | null;
  file_url: string;
}

export interface ShareResponse {
  kitchen: { name: string; address: string };
  renters: { business_name: string; documents: ShareDocument[] }[];
}

export interface ErrorBody {
  error: string;
  [key: string]: unknown;
}
