import type { Tier } from './benches.js';

export type Role = 'practitioner' | 'clinic' | 'director' | 'registrar' | 'frontdesk';

export type BenchState = 'open' | 'held' | 'held_by_you' | 'offered_to_you' | 'sold' | 'yours';

export type ReservationState =
  | 'held'
  | 'deposit_paid'
  | 'paid_in_full'
  | 'checked_in_day1'
  | 'checked_in_day2'
  | 'certificate_issued'
  | 'released'
  | 'cancelled'
  | 'refunded';

export interface AccountSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface BenchView {
  label: string;
  row: string;
  number: number;
  tier: Tier;
  state: BenchState;
}

export interface BenchesResponse {
  server_time: string;
  venue_date: string;
  deposits_open: boolean;
  seats_total: number;
  seats_remaining: number;
  held: number;
  sold: number;
  tiers: {
    bench: { remaining: number };
    atelier: { remaining: number; cap: number; active: number; sold_out: boolean };
  };
  benches: BenchView[];
}

export interface Reservation {
  id: string;
  bench: string;
  tier: Tier;
  state: ReservationState;
  group_id: string | null;
  buyer: { name: string; kind: 'practitioner' | 'clinic' };
  attendee: { name: string; email: string; accepted: boolean } | null;
  price_cents: number;
  paid_cents: number;
  balance_cents: number;
  refund_due_cents: number | null;
  hold: { expires_at: string; seconds_remaining: number; duration_seconds: number } | null;
  payment_pending: 'deposit' | 'balance' | 'full' | 'upgrade' | 'group' | null;
  licence_status: 'none' | 'submitted' | 'matched' | 'rejected';
  passport_status: 'none' | 'submitted';
  checked_in: { day1: boolean; day2: boolean };
  documents: string[];
}

export interface DeskReservation extends Reservation {
  buyer_email: string;
  kb: { paid_cents: number; refunded_cents: number } | null;
}

export interface Group {
  id: string;
  state: string;
  reservations: Reservation[];
  invoice: {
    kb_invoice_id: string;
    items: { bench: string; amount_cents: number }[];
    total_cents: number;
  } | null;
}

export interface Offer {
  id: string;
  bench: string;
  tier: Tier;
  state: string;
  seconds_remaining: number;
}

export interface MeResponse {
  account: AccountSummary;
  reservations: Reservation[];
  groups: Group[];
  waitlist: { tier: Tier; position: number } | null;
  offers: Offer[];
  venue_date: string;
  deposits_open: boolean;
  server_time: string;
}

export interface HoldResponse {
  reservations: Reservation[];
  group_id: string | null;
  seats_remaining: number;
  server_time: string;
}

export interface SessionContent {
  id: string;
  number: number;
  day: number;
  title: string;
  format: 'lecture' | 'hands-on';
  minutes: number;
  outcomes: string;
}

export interface HospitalityContent {
  id: string;
  title: string;
  day: number;
  tier: 'all' | 'atelier';
  gated?: boolean;
  starts_at?: string;
  venue?: string;
  description?: string;
}

export interface HotelContent {
  id: string;
  name: string;
  distance: string;
  rate: string;
  map_url: string;
}

export interface FaqContent {
  id: string;
  question: string;
  answer: string;
  sort: number;
}

export interface ContentResponse {
  sessions: SessionContent[];
  hospitality: HospitalityContent[];
  hotels: HotelContent[];
  faq: FaqContent[];
}

export interface Inventory {
  seats_total: number;
  seats_remaining: number;
  held: number;
  sold: number;
  waitlisted: { bench: number; atelier: number };
  atelier: { active: number; cap: number; remaining: number; sold_out: boolean };
}

export interface CheckinMatch {
  reservation_id: string;
  attendee_name: string;
  bench: string;
  day1: boolean;
  day2: boolean;
}

export interface CheckinResponse {
  q: string;
  venue_date: string;
  open_day: 1 | 2 | null;
  results: CheckinMatch[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  missing?: string[];
  waitlist?: { tier: Tier; open: boolean };
}
