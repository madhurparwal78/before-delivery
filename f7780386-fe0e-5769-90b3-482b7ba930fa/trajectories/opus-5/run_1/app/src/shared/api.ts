/** Wire shapes exchanged between the server and the browser. */

export type Role = 'operator' | 'member' | 'crew_cook';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  member_id: string | null;
  business_name: string | null;
}

export type HoldStatus = 'live' | 'confirmed' | 'expired' | 'released';

export interface CostPreview {
  booked_minutes: number;
  prepaid_minutes: number;
  overage_minutes: number;
  overage_amount: string;
}

export interface Hold {
  id: string;
  member_id: string;
  station_id: string;
  date: string;
  start: string;
  end: string;
  tail_end: string;
  status: HoldStatus;
  created_at: string;
  expires_at: string;
  preview: CostPreview;
}

export type BookingStatus =
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled_free'
  | 'cancelled_with_fee';

export type PaymentStatus = 'paid' | 'payment_pending' | 'voided';

export interface CheckIn {
  id: string;
  crew_cook_id: string;
  crew_cook_name: string;
  at: string;
  card_document_id: string;
}

export interface BookingFee {
  amount: string;
  status: 'pending' | 'charged' | 'waived';
}

export interface Booking {
  id: string;
  hold_id: string;
  member_id: string;
  business_name: string;
  station_id: string;
  station_name: string;
  date: string;
  start: string;
  end: string;
  tail_end: string;
  status: BookingStatus;
  payment: PaymentStatus;
  booked_minutes: number;
  prepaid_minutes: number;
  overage_minutes: number;
  overage_amount: string;
  list_amount: string;
  free_cancel_until: string;
  fee: BookingFee | null;
  check_ins: CheckIn[];
  confirmed_at: string;
  cancelled_at: string | null;
}

export type DocumentKind = 'liability_insurance' | 'food_handler_card';
export type DocumentStatus = 'uploaded' | 'approved' | 'rejected' | 'expired';

export interface DocumentRecord {
  id: string;
  member_id: string;
  kind: DocumentKind;
  crew_cook_id: string | null;
  crew_cook_name: string | null;
  expires_on: string;
  status: DocumentStatus;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

export type TransactionKind =
  | 'opening'
  | 'pack_purchase'
  | 'booking_debit'
  | 'cancellation_refund'
  | 'adjustment'
  | 'reversal';

export interface LedgerEntry {
  account: string;
  minutes: number;
}

export interface LedgerTransaction {
  id: string;
  kind: TransactionKind;
  created_at: string;
  member_minutes: number;
  booking_id: string | null;
  reason: string | null;
  reverses: string | null;
  reversed_by: string | null;
  entries: LedgerEntry[];
}

export interface Packet {
  id: string;
  from: string;
  to: string;
  expires_at: string;
  status: 'active' | 'revoked' | 'expired';
  url: string | null;
  token: string | null;
  created_at: string;
}

export interface StationInfo {
  id: string;
  name: string;
  hourly_rate: string;
  cleaning_minutes: number;
}

export interface PackInfo {
  id: string;
  name: string;
  minutes: number;
  price: string;
}

export type BillingState = 'up' | 'down';

export interface KitchenInfo {
  name: string;
  time_zone: string;
  now: string;
  today: string;
  hold_seconds: number;
  free_cancel_days: number;
  check_in_opens_minutes: number;
  booking_days_ahead: number;
  board: { opens: string; closes: string; cell_minutes: number };
  stations: StationInfo[];
  packs: PackInfo[];
  billing: BillingState;
}

export type Segment =
  | {
      kind: 'hold';
      id: string;
      start: string;
      end: string;
      tail_end: string;
      status: HoldStatus;
      expires_at: string;
      member_id?: string;
      business_name?: string;
    }
  | {
      kind: 'booking';
      id: string;
      start: string;
      end: string;
      tail_end: string;
      status: BookingStatus;
      payment: PaymentStatus;
      member_id?: string;
      business_name?: string;
    }
  | { kind: 'occupied'; start: string; end: string };

export interface BoardStation {
  id: string;
  name: string;
  segments: Segment[];
}

export interface BoardResponse {
  date: string;
  today: string;
  now: string;
  time_zone: string;
  billing: BillingState;
  stations: BoardStation[];
}

export interface MemberSummary {
  id: string;
  business_name: string;
  contact_email: string;
  balance_minutes: number;
  liability_insurance: { status: DocumentStatus; expires_on: string } | null;
}

export interface InvoiceLine {
  description: string;
  amount: string;
}

export interface Invoice {
  id: string;
  date: string;
  amount: string;
  balance: string;
  items: InvoiceLine[];
}

export interface UsageStationRow {
  station_id: string;
  station_name: string;
  booked_minutes: number;
  cleaning_minutes: number;
  bookings: number;
}

export interface UsageResponse {
  date: string;
  time_zone: string;
  stations: UsageStationRow[];
  total_booked_minutes: number;
}

export interface PacketValidity {
  valid: boolean;
  expires_on: string | null;
}

export interface PacketCrew {
  name: string;
  checked_in_at: string;
  food_handler_card: PacketValidity;
}

export interface PacketVisit {
  business_name: string;
  station: string;
  start: string;
  end: string;
  liability_insurance: PacketValidity;
  crew: PacketCrew[];
}

export interface PacketDay {
  date: string;
  visits: PacketVisit[];
}

export interface PacketSnapshot {
  kitchen: string;
  time_zone: string;
  from: string;
  to: string;
  generated_at: string;
  days: PacketDay[];
}
