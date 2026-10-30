export type ProgrammeState = 'draft' | 'review' | 'scheduled' | 'published' | 'cancelled';

export interface Session {
  id: string;
  title: string;
  description: string;
  discipline: string;
  venue_id: string;
  admission: 'pass' | 'seat';
  capacity: number | null;
  seats_remaining: number | null;
  price_full_cents: number | null;
  price_reduced_cents: number | null;
  starts_at: string;
  ends_at: string;
  starts_local: string;
  ends_local: string;
  festival_day: string;
  status: ProgrammeState;
  publish_at?: string | null;
  version?: number;
}

export interface FestivalDay {
  date: string;
  label: string;
  starts_at: string;
  ends_at: string;
}

export interface Named {
  id: string;
  name: string;
}

export interface PassPrices {
  full_festival_full_cents: number;
  full_festival_reduced_cents: number;
  day_full_cents: number;
  day_reduced_cents: number;
  group_discount_percent: number;
}

export interface Programme {
  edition: { name: string; first_day: string; last_day: string; time_zone: string };
  festival_days: FestivalDay[];
  venues: Named[];
  disciplines: Named[];
  sessions: Session[];
  price_policy: PassPrices;
}

export interface EntryImage {
  id: string;
  width: number;
  height: number;
  display_url: string | null;
}

export interface Entry {
  id: string;
  artist_id: string;
  artist_name: string;
  title: string;
  statement: string;
  discipline: string;
  medium: string;
  year: string;
  status: ProgrammeState;
  publish_at: string | null;
  images: EntryImage[];
}

export interface Hold {
  id: string;
  session_id: string;
  quantity: number;
  expires_at: string;
  status: 'active' | 'expired' | 'released' | 'converted';
  seats_remaining?: number;
}

export interface Line {
  id: string;
  position: number;
  kind: 'seat' | 'full_festival' | 'day';
  session_id: string | null;
  festival_day: string | null;
  title: string;
  holder_name: string;
  state: string;
  list_cents: number;
  group_discount_cents: number;
  voucher_cents: number;
  charged_cents: number;
  pass: { code: string; status: string } | null;
}

export interface Refund {
  id: string;
  order_id: string;
  line_ids: string[];
  card_cents: number;
  voucher_cents: number;
  credit_note_id: string | null;
  status: 'pending' | 'completed';
  reason: string;
  created_at: string;
}

export interface Order {
  id: string;
  ref: string;
  buyer_name: string;
  organisation_id: string | null;
  rate: 'full' | 'reduced';
  status: string;
  subtotal_cents: number;
  group_discount_cents: number;
  voucher_code: string | null;
  voucher_cents: number;
  total_cents: number;
  proof_deadline: string | null;
  confirmation_mail: 'sent' | 'pending';
  invoice_id: string | null;
  created_at: string;
  lines: Line[];
  refunds: Refund[];
}

export interface WaitlistEntry {
  id: string;
  session_id: string;
  title: string;
  position: number;
  status: 'waiting' | 'offered' | 'claimed' | 'lapsed' | 'closed';
  offer_expires_at: string | null;
}

export interface Proof {
  id: string;
  order_id: string;
  order_ref: string;
  kind: 'student' | 'jobseeker';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  uploaded_at: string;
  deadline: string;
  content_type: string;
  size_bytes: number;
  buyer_name?: string;
}

export interface Invoice {
  id: string;
  number: string;
  organisation_id: string;
  order_id: string;
  status: string;
  amount_cents: number;
  credited_cents: number;
  paid_cents: number;
  balance_cents: number;
  issued_at: string;
  due_at: string;
  retries_used: number;
  next_retry_at: string | null;
  credit_note_ids: string[];
  lines: Array<{ line_id: string; description: string; amount_cents: number }>;
}

export interface CreditNote {
  id: string;
  number: string;
  invoice_id: string;
  amount_cents: number;
  issued_at: string;
  lines: Array<{ line_id: string; description: string; amount_cents: number }>;
}

export interface Mismatch {
  id: string;
  run_id: string;
  type: string;
  order_ref: string | null;
  killbill_transaction_id: string | null;
  transaction_type: string;
  app_amount_cents: number | null;
  killbill_amount_cents: number | null;
  status: 'open' | 'resolved';
  note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: unknown;
}

export interface PricePolicy {
  full_festival_full_cents: number;
  full_festival_reduced_cents: number;
  day_full_cents: number;
  day_reduced_cents: number;
  group_discount_percent: number;
  version: number;
}

export type Role =
  | 'visitor'
  | 'group_booker'
  | 'artist'
  | 'curator'
  | 'box_office'
  | 'finance'
  | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  organisation_id: string | null;
}
