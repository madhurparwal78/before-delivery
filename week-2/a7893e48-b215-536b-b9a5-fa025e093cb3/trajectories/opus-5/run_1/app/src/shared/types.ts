export type Role = 'renter' | 'front_desk' | 'manager';

export type SegmentState = 'booked' | 'held' | 'yours_booked' | 'yours_held';

export type HoldStatus = 'held' | 'expired' | 'confirmed';

export type BookingStatus =
  | 'confirmed'
  | 'checked_in'
  | 'overrun_billed'
  | 'checked_out'
  | 'settled'
  | 'cancelled_refunded'
  | 'cancelled_forfeit'
  | 'unpaid_cancelled';

export type DocumentKind = 'liability' | 'food_handler';

export type PackAccount = 'purchased' | 'available' | 'reserved' | 'used';

export type PackReason = 'purchase' | 'reserve' | 'release' | 'use' | 'forfeit';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  operator_id: string;
  site_ids: string[];
  renter_id: string | null;
}

export interface StationSummary {
  id: string;
  name: string;
  rate_cents: number;
}

export interface Site {
  id: string;
  name: string;
  time_zone: string;
  deposit_cents: number;
  cleaning_fee_cents: number;
  policy_notice_hours: number;
  stations: StationSummary[];
}

export interface DayTick {
  at: string;
  label: string;
  zone: string;
}

export interface DaySegment {
  start_at: string;
  end_at: string;
  state: SegmentState;
  label: string;
  booking_id: string | null;
  hold_id: string | null;
  renter_business: string | null;
}

export interface DayStation {
  id: string;
  name: string;
  rate_cents: number;
  segments: DaySegment[];
}

export interface DayView {
  site_id: string;
  date: string;
  time_zone: string;
  hours: number;
  ticks: DayTick[];
  pack_minutes_available: number | null;
  stations: DayStation[];
}

export interface HoldOccurrence {
  date: string;
  start: string;
  end: string;
  start_at: string;
  end_at: string;
  minutes: number;
}

export interface HoldQuote {
  pack_minutes_available: number;
  pack_minutes: number;
  card_minutes: number;
  card_cents: number;
  deposit_cents: number;
}

export interface Hold {
  id: string;
  status: HoldStatus;
  station_id: string;
  site_id: string;
  renter_id: string;
  created_at: string;
  expires_at: string;
  occurrences: HoldOccurrence[];
  quote: HoldQuote;
}

export interface BookingPolicy {
  version_id: string;
  notice_hours: number;
  effective_from: string;
}

export interface Booking {
  id: string;
  hold_id: string | null;
  site_id: string;
  station_id: string;
  station_name: string;
  renter_id: string;
  renter_business: string;
  status: BookingStatus;
  start_at: string;
  end_at: string;
  local_start: string;
  local_end: string;
  minutes: number;
  pack_minutes: number;
  card_minutes: number;
  card_cents: number;
  deposit_cents: number;
  paid: boolean;
  balance_due_cents: number;
  balance_due_by: string | null;
  policy: BookingPolicy;
  confirmed_at: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  overrun_minutes: number;
  overrun_cents: number;
  cleaning_fee_cents: number;
  terms: string;
}

export interface InvoiceLine {
  description: string;
  minutes: number | null;
  amount_cents: number;
}

export interface Invoice {
  booking_id: string;
  renter_business: string;
  site_name: string;
  lines: InvoiceLine[];
  total_cents: number;
  paid_cents: number;
  refunded_cents: number;
  balance_due_cents: number;
  terms: string;
}

export interface AuditEvent {
  at: string;
  actor_name: string;
  actor_role: Role | 'system';
  action: string;
  from: string;
  to: string;
  reason: string | null;
}

export interface RefundOutcome {
  tier: 'full' | 'none';
  pack_minutes_returned: number;
  card_refund_cents: number;
  deposit_refund_cents: number;
}

export interface PackEntry {
  id: string;
  movement_id: string;
  account: PackAccount;
  minutes: number;
  reason: PackReason;
  booking_id: string | null;
  pack_id: string | null;
  created_at: string;
}

export interface PackLedger {
  available_minutes: number;
  reserved_minutes: number;
  used_minutes: number;
  entries: PackEntry[];
}

export interface RenterSummary {
  id: string;
  name: string;
  business: string;
  email: string;
  home_site_id: string;
}

export interface RenterDocument {
  id: string;
  kind: DocumentKind;
  valid_from: string;
  expires_on: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface DashboardSite {
  site_id: string;
  name: string;
  local_date: string;
  bookings_today: number;
  booked_minutes_today: number;
  unpaid_balance_cents: number;
  expiring_documents: number;
}

export interface DashboardTotals {
  bookings_today: number;
  booked_minutes_today: number;
  unpaid_balance_cents: number;
  expiring_documents: number;
}

export interface Dashboard {
  sites: DashboardSite[];
  totals: DashboardTotals;
}

export interface UtilisationStation {
  station_id: string;
  name: string;
  booked_minutes: number;
  utilisation_percent: number;
}

export interface Utilisation {
  site_id: string;
  date: string;
  time_zone: string;
  day_minutes: number;
  stations: UtilisationStation[];
}

export interface PolicyVersion {
  id: string;
  notice_hours: number;
  effective_from: string;
  effective_at: string;
  created_by_name: string;
  created_at: string;
}

export interface BinderLink {
  id: string;
  site_id: string;
  from: string;
  to: string;
  url: string;
  expires_at: string;
  revoked: boolean;
  created_at: string;
}

export interface BinderDocumentStatus {
  status: 'current' | 'expired' | 'missing';
  expires_on: string | null;
}

export interface BinderRow {
  date: string;
  renter_name: string;
  business: string;
  station: string;
  local_start: string;
  local_end: string;
  liability: BinderDocumentStatus;
  food_handler: BinderDocumentStatus;
}

export interface Binder {
  site_name: string;
  from: string;
  to: string;
  generated_at: string;
  rows: BinderRow[];
}

export interface ServiceStatus {
  billing: 'ok' | 'delayed';
  mail: 'ok' | 'delayed';
  queued_emails: number;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  blocker?: DaySegment & { date: string };
  dates?: string[];
  from?: string;
  action?: string;
  limit_bytes?: number;
}
