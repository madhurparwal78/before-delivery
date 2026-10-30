// The published API shapes (brief: API, Published fields).
import type {
  BookingStatus,
  DocumentKind,
  DocumentStatus,
  InvoiceStatus,
  LedgerAccount,
  LedgerReason,
  LineKind,
  PayWith,
  Role,
  StationKind,
  TenantStatus,
} from "./kitchen";

export interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenant_id: string | null;
}

export interface RequiredDocument {
  valid: boolean;
  expires_on: string | null;
}

export interface Tenant {
  id: string;
  business_name: string;
  status: TenantStatus;
  owner_name: string;
  owner_email: string;
  required_documents: Record<"certificate_of_insurance" | "health_permit" | "food_handler_card", RequiredDocument>;
  shelves: string[];
  hour_balance_minutes: number;
}

export interface Station {
  id: string;
  name: string;
  kind: StationKind;
  hourly_rate_cents: number;
}

export interface FullBlock {
  kind: "booking" | "hold";
  booking_id: string;
  ref: string;
  hold_ref: string;
  status: BookingStatus;
  start_minute: number;
  end_minute: number;
  tenant_id: string;
  tenant_name: string;
  notes: string;
  contact_email?: string;
  expires_at: string | null;
}

export interface AnonymousBlock {
  kind: "booked" | "cleaning";
  start_minute: number;
  end_minute: number;
}

export type Block = FullBlock | AnonymousBlock;

export interface DialStation extends Station {
  blocks: Block[];
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

export interface PolicyTerms {
  version: number;
  free_window_hours: number;
  late_fee_percent: number;
}

export interface Policy extends PolicyTerms {
  effective_at: string;
}

export interface Holdover {
  reported_minutes: number;
  billed_minutes: number;
  amount_cents: number;
}

export interface Cancellation {
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
  pay_with: PayWith | null;
  amount_cents: number | null;
  policy: PolicyTerms | null;
  notes: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  holdover: Holdover | null;
  cancellation: Cancellation | null;
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

export interface HourPack {
  id: string;
  name: string;
  minutes: number;
  price_cents: number;
}

export interface Purchase {
  purchase_id: string;
  pack_id: string;
  minutes: number;
  price_cents: number;
  balance_minutes: number;
}

export interface LedgerEntry {
  id: string;
  movement_id: string;
  account: LedgerAccount;
  minutes: number;
  reason: LedgerReason;
  booking_id: string | null;
  created_at: string;
}

export interface Ledger {
  tenant_id: string;
  balance_minutes: number;
  entries: LedgerEntry[];
}

export interface ComplianceDocument {
  id: string;
  tenant_id: string;
  kind: DocumentKind;
  holder_name: string | null;
  expires_on: string;
  status: DocumentStatus;
  valid: boolean;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

export interface InspectionLink {
  url: string;
  expires_at: string;
}

export interface InspectionView {
  kitchen_name: string;
  business_name: string;
  expires_at: string;
  documents: { id: string; kind: DocumentKind; holder_name: string | null; expires_on: string; file_url: string }[];
}

export interface Shelf {
  id: string;
  name: string;
  monthly_rate_cents: number;
  tenant_id: string | null;
  tenant_name: string | null;
}

export interface InvoiceLine {
  kind: LineKind;
  description: string;
  booking_ref: string | null;
  amount_cents: number;
}

export interface Invoice {
  id: string;
  number: string;
  tenant_id: string;
  period: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  subtotal_cents: number;
  tax_rate_percent: string;
  tax_cents: number;
  total_cents: number;
  issued_at: string;
  paid_at: string | null;
}
