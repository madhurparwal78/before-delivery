/** Wire types shared by server and client, per the API's published fields. */

export type Role = "operator" | "owner" | "cook";
export type TenantStatus =
  | "applied"
  | "documents_review"
  | "active"
  | "suspended"
  | "offboarded";
export type DocumentKind = "certificate_of_insurance" | "food_handler_card" | "health_permit";
export type StationKind = "hot_line" | "bake_deck" | "cold_prep";
export type BookingStatus =
  | "held"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "cancelled"
  | "no_show";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenant_id: string | null;
}

export interface RequiredDocumentState {
  valid: boolean;
  expires_on: string | null;
}

export interface Tenant {
  id: string;
  business_name: string;
  status: TenantStatus;
  owner_name: string;
  owner_email: string;
  required_documents: Record<DocumentKind, RequiredDocumentState>;
  shelves: string[];
  hour_balance_minutes: number;
}

export interface Station {
  id: string;
  name: string;
  kind: StationKind;
  hourly_rate_cents: number;
}

export interface DialBlock {
  kind: "booking" | "hold" | "booked" | "cleaning";
  booking_id?: string;
  ref?: string;
  hold_ref?: string;
  status?: BookingStatus;
  start_minute: number;
  end_minute: number;
  tenant_id?: string;
  tenant_name?: string;
  notes?: string;
  contact_email?: string;
  expires_at?: string | null;
}

export interface DialStation extends Station {
  blocks: DialBlock[];
}

export interface DialDay {
  date: string;
  today: string;
  now_minute: number | null;
  time_zone: string;
  skipped: [number, number] | null;
  repeated: [number, number] | null;
  stations: DialStation[];
}

export interface CancellationPolicy {
  version: number;
  free_window_hours: number;
  late_fee_percent: number;
  effective_at: string;
}

export interface BookingPolicy {
  version: number;
  free_window_hours: number;
  late_fee_percent: number;
}

export interface HoldoverInfo {
  reported_minutes: number;
  billed_minutes: number;
  amount_cents: number;
}

export interface CancellationInfo {
  cancelled_at: string;
  late: boolean;
  fee_cents: number;
  fee_minutes: number;
  fee_refunded: boolean;
}

export interface Booking {
  id: string;
  ref: string;
  hold_ref: string;
  tenant_id: string;
  station_id: string;
  date: string;
  start_local: string;
  end_local: string;
  start: string;
  end: string;
  elapsed_minutes: number;
  status: BookingStatus;
  pay_with: "account" | "hour_pack" | null;
  amount_cents: number | null;
  policy: BookingPolicy | null;
  notes: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  holdover: HoldoverInfo | null;
  cancellation: CancellationInfo | null;
  created_at: string;
  tenant_name?: string;
}

export interface Hold {
  ref: string;
  tenant_id: string;
  station_id: string;
  weeks: number;
  expires_at: string;
  bookings: Booking[];
}

export interface Document {
  id: string;
  tenant_id: string;
  kind: DocumentKind;
  holder_name: string | null;
  expires_on: string;
  status: "pending_review" | "approved" | "rejected";
  valid: boolean;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

export interface InvoiceLine {
  kind: "station_time" | "holdover" | "late_fee" | "storage";
  description: string;
  booking_ref: string | null;
  amount_cents: number;
}

export interface Invoice {
  id: string;
  number: string;
  tenant_id: string;
  period: string;
  status: "issued" | "paid";
  lines: InvoiceLine[];
  subtotal_cents: number;
  tax_rate_percent: string;
  tax_cents: number;
  total_cents: number;
  issued_at: string;
  paid_at: string | null;
}

export interface HourPack {
  id: string;
  name: string;
  minutes: number;
  price_cents: number;
}

export interface HourPackPurchase {
  purchase_id: string;
  pack_id: string;
  minutes: number;
  price_cents: number;
  balance_minutes: number;
}

export interface HourLedgerEntry {
  id: string;
  movement_id: string;
  account: "tenant_pack" | "kitchen_hours";
  minutes: number;
  reason:
    | "opening_balance"
    | "pack_purchase"
    | "booking"
    | "cancellation_return"
    | "fee_refund";
  booking_id: string | null;
  created_at: string;
}

export interface HourLedger {
  tenant_id: string;
  balance_minutes: number;
  entries: HourLedgerEntry[];
}

export interface Shelf {
  id: string;
  name: string;
  monthly_rate_cents: number;
  tenant_id: string | null;
  tenant_name: string | null;
}

export interface InspectionLinkInfo {
  url: string;
  expires_at: string;
}

export interface InspectDocument {
  id: string;
  kind: DocumentKind;
  holder_name: string | null;
  expires_on: string;
  file_url: string;
}

export interface InspectView {
  kitchen_name: string;
  business_name: string;
  expires_at: string;
  documents: InspectDocument[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  certificate_of_insurance: "Certificate of insurance",
  food_handler_card: "Food handler card",
  health_permit: "Health permit"
};
