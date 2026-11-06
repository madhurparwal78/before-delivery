export type UserRole = 'operator' | 'owner' | 'cook';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenant_id: string | null;
}

export interface RequiredDocumentState {
  valid: boolean;
  expires_on: string | null;
}

export interface Tenant {
  id: string;
  business_name: string;
  status: 'applied' | 'documents_review' | 'active' | 'suspended' | 'offboarded';
  owner_name: string;
  owner_email: string;
  required_documents: Record<string, RequiredDocumentState>;
  shelves: string[];
  hour_balance_minutes: number;
}

export interface DialBlock {
  kind: 'booking' | 'hold' | 'booked' | 'cleaning';
  booking_id?: string;
  ref?: string;
  hold_ref?: string;
  status?: string;
  start_minute: number;
  end_minute: number;
  tenant_id?: string;
  tenant_name?: string;
  notes?: string;
  contact_email?: string;
  expires_at?: string | null;
}

export interface DialStation {
  id: string;
  name: string;
  kind: string;
  hourly_rate_cents: number;
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

export interface BookingPolicy {
  version: number;
  free_window_hours: number;
  late_fee_percent: number;
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
  status: 'held' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
  pay_with: 'account' | 'hour_pack' | null;
  amount_cents: number | null;
  policy: BookingPolicy | null;
  notes: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  holdover: { reported_minutes: number; billed_minutes: number; amount_cents: number } | null;
  cancellation: {
    cancelled_at: string;
    late: boolean;
    fee_cents: number;
    fee_minutes: number;
    fee_refunded: boolean;
  } | null;
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

export interface DocumentRow {
  id: string;
  tenant_id: string;
  kind: 'certificate_of_insurance' | 'food_handler_card' | 'health_permit';
  holder_name: string | null;
  expires_on: string;
  status: 'pending_review' | 'approved' | 'rejected';
  valid: boolean;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

export interface InvoiceLine {
  kind: 'station_time' | 'holdover' | 'late_fee' | 'storage';
  description: string;
  booking_ref: string | null;
  amount_cents: number;
}

export interface Invoice {
  id: string;
  number: string;
  tenant_id: string;
  period: string;
  status: 'issued' | 'paid';
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

export interface LedgerEntry {
  id: string;
  movement_id: string;
  account: 'tenant_pack' | 'kitchen_hours';
  minutes: number;
  reason: string;
  booking_id: string | null;
  created_at: string;
}

export interface HourLedger {
  tenant_id: string;
  balance_minutes: number;
  entries: LedgerEntry[];
}

export interface Shelf {
  id: string;
  name: string;
  monthly_rate_cents: number;
  tenant_id: string | null;
  tenant_name: string | null;
}

export interface Policy {
  version: number;
  free_window_hours: number;
  late_fee_percent: number;
  effective_at: string;
}

export interface InspectionLink {
  url: string;
  expires_at: string;
}

export interface InspectionDocument {
  id: string;
  kind: string;
  holder_name: string | null;
  expires_on: string;
  file_url: string;
}

export interface InspectionView {
  kitchen_name: string;
  business_name: string;
  expires_at: string;
  documents: InspectionDocument[];
}
