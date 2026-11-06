// The API's JSON shapes, shared by the server's serialisers and the browser.

import type { DocumentKind, DocumentStatus } from "./documents.js";

export type Role = "operator" | "shift_lead" | "renter";
export type RenterStatus = "applied" | "documents_review" | "active" | "suspended" | "offboarded";
type ComplianceState = "current" | "expiring" | "lapsed" | "incomplete";
export type BookingStatus = "hold" | "confirmed" | "checked_in" | "completed" | "expired" | "cancelled" | "displaced";
export type MovementKind =
  | "opening_balance"
  | "pack_purchase"
  | "booking_hold"
  | "hold_release"
  | "cancellation_credit"
  | "displacement_credit"
  | "checkout"
  | "cancellation_forfeit"
  | "adjustment";

export interface UserView {
  id: string;
  name: string;
  email: string;
  role: Role;
  renter_id: string | null;
  renter_status: RenterStatus | null;
}

export interface ComplianceView {
  state: ComplianceState;
  coi_expires_on: string | null;
  card_expires_on: string | null;
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
  compliance: ComplianceView;
}

export interface ShelfSubscriptionView {
  shelf_label: string;
  plan: "walk-in-shelf-monthly";
  external_key: string;
  killbill_subscription_id: string;
  state: "active" | "cancelled";
  billing_state: "ACTIVE" | "CANCELLED" | "unknown";
}

export interface RenterView extends RenterSummary {
  shelf_subscription: ShelfSubscriptionView | null;
}

export interface DocumentView {
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

export interface PackView {
  id: string;
  name: string;
  hours: number;
  amount_usd: string;
}

export interface PurchaseView {
  id: string;
  pack_id: string;
  pack_name: string;
  hours: number;
  amount_usd: string;
  killbill_payment_id: string;
  created_at: string;
}

export interface LedgerEntryView {
  id: string;
  movement_id: string;
  kind: MovementKind;
  account: string;
  direction: "debit" | "credit";
  minutes: number;
  booking_id: string | null;
  purchase_id: string | null;
  note: string | null;
  created_at: string;
}

export interface LedgerView {
  balance_minutes: number;
  held_minutes: number;
  entries: LedgerEntryView[];
}

export interface StationSettingsView {
  station_id: string;
  effective_from: string;
  hour_weight: number;
  off_peak_percent: number;
  overage_usd_per_hour: string;
  buffer_minutes: number;
}

export interface BlockView {
  kind: "booking" | "hold" | "maintenance";
  start: string;
  end: string;
  starts_at: string;
  ends_at: string;
  buffer_ends_at: string;
  mine: boolean;
  booking_id: string | null;
  renter_business_name: string | null;
}

export interface StationView {
  id: string;
  name: string;
  hour_weight: number;
  off_peak_percent: number;
  overage_usd_per_hour: string;
  buffer_minutes: number;
  upcoming_settings: StationSettingsView[];
  blocks: BlockView[];
}

export interface StationsResponse {
  date: string;
  time_zone: string;
  server_now: string;
  stations: StationView[];
}

export interface BookingView {
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
  hold_expires_at: string;
  cancellation_cutoff_at: string;
  actual_start: string | null;
  actual_end: string | null;
  overage_units: number | null;
  overage_usd: string | null;
  created_at: string;
}

export interface BookingsResponse {
  server_now: string;
  bookings: BookingView[];
}

export interface CancelResponse {
  booking: BookingView;
  outcome: "credited" | "forfeited";
  minutes: number;
}

export interface UsageRowView {
  booking_id: string;
  station_name: string;
  renter_business_name: string;
  start: string;
  end: string;
  actual_start: string | null;
  actual_end: string | null;
  status: "confirmed" | "checked_in" | "completed";
  overage_units: number | null;
  overage_usd: string | null;
}

export interface UsageSheetResponse {
  date: string;
  time_zone: string;
  server_now: string;
  rows: UsageRowView[];
}

export interface MaintenanceBlockView {
  id: string;
  station_id: string;
  date: string;
  start: string;
  end: string;
  reason: string;
}

export interface StatementView {
  id: string;
  renter_id: string;
  month: string;
  created_at: string;
}

export interface ComplianceLinkView {
  id: string;
  label: string;
  token: string;
  url: string;
  expires_in_seconds: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface NotificationView {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: "queued" | "sent";
  attempts: number;
  created_at: string;
  sent_at: string | null;
}

export interface SharedDocumentView {
  id: string;
  kind: DocumentKind;
  label: string;
  expires_on: string | null;
  file_url: string;
}

export interface ShareView {
  kitchen: { name: string; address: string };
  renters: { business_name: string; documents: SharedDocumentView[] }[];
}

export interface ErrorBody {
  error: string;
  errors?: Record<string, string>;
}
