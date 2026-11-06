/** The database row shapes the server reads. */

import type {
  BookingStatus,
  DocumentKind,
  DocumentStatus,
  RenterStatus,
  Role,
} from '../shared/types.js';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
}

export interface RenterRow {
  id: string;
  user_id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  status: RenterStatus;
  killbill_account_id: string | null;
}

export interface DocumentRow {
  id: string;
  renter_id: string;
  kind: DocumentKind;
  expires_on: string | null;
  status: DocumentStatus;
  original_name: string;
  size_bytes: number;
  content_type: string;
  object_key: string;
  created_at: Date;
  seq: number;
}

export interface BookingRow {
  id: string;
  series_id: string;
  station_id: string;
  station_name: string;
  renter_id: string;
  status: BookingStatus;
  date: string;
  start_hhmm: string;
  end_hhmm: string;
  starts_at: Date;
  ends_at: Date;
  buffer_minutes: number;
  hour_weight: number;
  off_peak_percent: number;
  overage_usd_per_hour: string;
  minutes_debited: number;
  hold_expires_at: Date | null;
  cancellation_cutoff_at: Date;
  actual_start: string | null;
  actual_end: string | null;
  actual_end_at: Date | null;
  overage_units: number | null;
  overage_usd: string | null;
  created_at: Date;
}

export interface StationRow {
  id: string;
  name: string;
  sort_order: number;
}

export interface StatementRow {
  id: string;
  renter_id: string;
  month: string;
  object_key: string;
  created_at: Date;
}

export interface MaintenanceBlockRow {
  id: string;
  station_id: string;
  date: string;
  start_hhmm: string;
  end_hhmm: string;
  starts_at: Date;
  ends_at: Date;
  reason: string;
}

export interface ComplianceLinkRow {
  id: string;
  label: string;
  token: string;
  expires_in_seconds: number;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export interface ShelfSubscriptionRow {
  id: string;
  renter_id: string;
  shelf_label: string;
  plan: string;
  external_key: string;
  killbill_subscription_id: string;
  state: 'active' | 'cancelled';
  ordinal: number;
}

export interface PackRow {
  id: string;
  name: string;
  hours: number;
  amount_usd: string;
}

export const BOOKING_COLUMNS = `
  b.id, b.series_id, b.station_id, s.name AS station_name, b.renter_id, b.status, b.date,
  b.start_hhmm, b.end_hhmm, b.starts_at, b.ends_at, b.buffer_minutes, b.hour_weight,
  b.off_peak_percent, b.overage_usd_per_hour::text AS overage_usd_per_hour, b.minutes_debited,
  b.hold_expires_at, b.cancellation_cutoff_at, b.actual_start, b.actual_end, b.actual_end_at,
  b.overage_units, b.overage_usd::text AS overage_usd, b.created_at`;

export const DOCUMENT_COLUMNS = `
  id, renter_id, kind, expires_on, status, original_name, size_bytes, content_type,
  object_key, created_at, seq::int AS seq`;
