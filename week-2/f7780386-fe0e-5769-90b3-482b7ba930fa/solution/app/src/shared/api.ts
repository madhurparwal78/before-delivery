// JSON shapes of the public API, shared by the server that writes them and the browser that reads them.

export type Role = "operator" | "member" | "crew_cook";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  member_id: string | null;
  business_name: string | null;
}

export interface Station {
  id: string;
  name: string;
  hourly_rate: string;
  cleaning_minutes: number;
}

export interface Pack {
  id: string;
  name: string;
  minutes: number;
  price: string;
}

export type BillingState = "up" | "down";

export interface Kitchen {
  name: string;
  time_zone: string;
  now: string;
  today: string;
  hold_seconds: number;
  free_cancel_days: number;
  check_in_opens_minutes: number;
  booking_days_ahead: number;
  board: { opens: string; closes: string; cell_minutes: number };
  stations: Station[];
  packs: Pack[];
  billing: BillingState;
}

export type HoldStatus = "live" | "confirmed" | "expired" | "released";
export type BookingStatus = "confirmed" | "checked_in" | "completed" | "cancelled_free" | "cancelled_with_fee";
export type Payment = "paid" | "payment_pending" | "voided";
export type FeeStatus = "pending" | "charged" | "waived";

interface CostPreview {
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

export interface CheckIn {
  id: string;
  crew_cook_id: string;
  crew_cook_name: string;
  at: string;
  card_document_id: string;
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
  payment: Payment;
  booked_minutes: number;
  prepaid_minutes: number;
  overage_minutes: number;
  overage_amount: string;
  list_amount: string;
  free_cancel_until: string;
  fee: null | { amount: string; status: FeeStatus };
  check_ins: CheckIn[];
  confirmed_at: string;
  cancelled_at: string | null;
}

interface HoldSegment {
  kind: "hold";
  id: string;
  start: string;
  end: string;
  tail_end: string;
  status: HoldStatus;
  expires_at: string;
  member_id?: string;
  business_name?: string;
}

interface BookingSegment {
  kind: "booking";
  id: string;
  start: string;
  end: string;
  tail_end: string;
  status: BookingStatus;
  payment: Payment;
  member_id?: string;
  business_name?: string;
}

interface OccupiedSegment {
  kind: "occupied";
  start: string;
  end: string;
}

export type Segment = HoldSegment | BookingSegment | OccupiedSegment;

export interface Board {
  date: string;
  today: string;
  now: string;
  time_zone: string;
  billing: BillingState;
  stations: { id: string; name: string; segments: Segment[] }[];
}

export type DocumentKind = "liability_insurance" | "food_handler_card";
export type DocumentStatus = "uploaded" | "approved" | "rejected" | "expired";

export interface CertificateDocument {
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

export type TransactionKind = "opening" | "pack_purchase" | "booking_debit" | "cancellation_refund" | "adjustment" | "reversal";

export interface LedgerTransaction {
  id: string;
  kind: TransactionKind;
  created_at: string;
  member_minutes: number;
  booking_id: string | null;
  reason: string | null;
  reverses: string | null;
  reversed_by: string | null;
  entries: { account: string; minutes: number }[];
}

export interface Ledger {
  member_id: string;
  balance_minutes: number;
  transactions: LedgerTransaction[];
}

export interface MemberSummary {
  id: string;
  business_name: string;
  contact_email: string;
  balance_minutes: number;
  liability_insurance: { status: DocumentStatus; expires_on: string } | null;
}

export interface Invoice {
  id: string;
  date: string;
  amount: string;
  balance: string;
  items: { description: string; amount: string }[];
}

export type PacketStatus = "active" | "revoked" | "expired";

export interface Packet {
  id: string;
  from: string;
  to: string;
  expires_at: string;
  status: PacketStatus;
  url: string | null;
  token: string | null;
  created_at: string;
}

export interface Validity {
  valid: boolean;
  expires_on: string | null;
}

export interface PacketVisit {
  business_name: string;
  station: string;
  start: string;
  end: string;
  liability_insurance: Validity;
  crew: { name: string; checked_in_at: string; food_handler_card: Validity }[];
}

export interface PacketSnapshot {
  kitchen: string;
  time_zone: string;
  from: string;
  to: string;
  generated_at: string;
  days: { date: string; visits: PacketVisit[] }[];
}

interface StationUsage {
  station_id: string;
  station_name: string;
  booked_minutes: number;
  cleaning_minutes: number;
  bookings: number;
}

export interface Usage {
  date: string;
  time_zone: string;
  stations: StationUsage[];
  total_booked_minutes: number;
}

export interface ErrorBody {
  error: string;
  errors?: Record<string, string>;
  missing?: string[];
}
