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

export interface SegmentBase {
  start: string;
  end: string;
}
export interface OwnHoldSegment extends SegmentBase {
  kind: 'hold';
  id: string;
  end: string;
  tail_end: string;
  status: string;
  expires_at: string;
}
export interface OwnBookingSegment extends SegmentBase {
  kind: 'booking';
  id: string;
  tail_end: string;
  status: string;
  payment: string;
}
export interface OperatorHoldSegment extends OwnHoldSegment {
  member_id: string;
  business_name: string;
}
export interface OperatorBookingSegment extends OwnBookingSegment {
  member_id: string;
  business_name: string;
}
export interface OccupiedSegment extends SegmentBase {
  kind: 'occupied';
}
export type MemberSegment = OwnHoldSegment | OwnBookingSegment | OccupiedSegment;
export type OperatorSegment = OperatorHoldSegment | OperatorBookingSegment;
export type CrewSegment = OwnBookingSegment | OccupiedSegment;
export type AnySegment = MemberSegment | OperatorSegment | CrewSegment;

export interface BoardResponse {
  date: string;
  today: string;
  now: string;
  time_zone: string;
  billing: 'up' | 'down';
  stations: { id: string; name: string; segments: AnySegment[] }[];
}

export interface CostSplit {
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
  status: 'live' | 'confirmed' | 'expired' | 'released';
  created_at: string;
  expires_at: string;
  preview: CostSplit;
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
  status: 'confirmed' | 'checked_in' | 'completed' | 'cancelled_free' | 'cancelled_with_fee';
  payment: 'paid' | 'payment_pending' | 'voided';
  booked_minutes: number;
  prepaid_minutes: number;
  overage_minutes: number;
  overage_amount: string;
  list_amount: string;
  free_cancel_until: string;
  fee: { amount: string; status: 'pending' | 'charged' | 'waived' } | null;
  check_ins: CheckIn[];
  confirmed_at: string;
  cancelled_at: string | null;
}

export interface LedgerEntry {
  account: string;
  minutes: number;
}

export interface Transaction {
  id: string;
  kind: 'opening' | 'pack_purchase' | 'booking_debit' | 'cancellation_refund' | 'adjustment' | 'reversal';
  created_at: string;
  member_minutes: number;
  booking_id: string | null;
  reason: string | null;
  reverses: string | null;
  reversed_by: string | null;
  entries: [LedgerEntry, LedgerEntry];
}

export interface Document {
  id: string;
  member_id: string;
  kind: 'liability_insurance' | 'food_handler_card';
  crew_cook_id: string | null;
  crew_cook_name: string | null;
  expires_on: string;
  status: 'uploaded' | 'approved' | 'rejected' | 'expired';
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'operator' | 'member' | 'crew_cook';
  member_id: string | null;
  business_name: string | null;
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

export interface PacketDayVisit {
  business_name: string;
  station: string;
  start: string;
  end: string;
  liability_insurance: { valid: boolean; expires_on: string | null };
  crew: { name: string; checked_in_at: string; food_handler_card: { valid: boolean; expires_on: string | null } }[];
}

export interface PacketContent {
  kitchen: string;
  time_zone: string;
  from: string;
  to: string;
  generated_at: string;
  days: { date: string; visits: PacketDayVisit[] }[];
}

export interface InvoiceItem {
  description: string;
  amount: string;
}

export interface Invoice {
  id: string;
  date: string;
  amount: string;
  balance: string;
  items: InvoiceItem[];
}

export interface UsageStation {
  station_id: string;
  station_name: string;
  booked_minutes: number;
  cleaning_minutes: number;
  bookings: number;
}

export interface UsageResponse {
  date: string;
  time_zone: string;
  stations: UsageStation[];
  total_booked_minutes: number;
}

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
  billing: 'up' | 'down';
}

export interface LedgerResponse {
  member_id?: string;
  member_id_required?: boolean;
  balance_minutes: number;
  transactions: Transaction[];
}
