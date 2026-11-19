import type { Member } from './state.js';
import type { SeatMapEntry } from '../shared/seats.js';

export interface Vehicle {
  id: string;
  make_model: string;
  colour: string;
  seats: number;
}

export interface RideStop {
  city: string;
  km: number;
  time: string;
}

export interface RideLeg {
  index: number;
  from: string;
  to: string;
  km: number;
}

export interface Ride {
  id: string;
  state: 'published' | 'changed' | 'departed' | 'arrived' | 'cancelled';
  version: number;
  driver: Member;
  vehicle: Vehicle | null;
  booking_mode: 'instant' | 'request';
  seats: number;
  price_cents: number;
  route_km: number;
  departure: string;
  previous_departure: string | null;
  free_cancel_until: string | null;
  arrival: string;
  stops: RideStop[];
  legs: RideLeg[];
  seat_map: SeatMapEntry[];
  server_now: string;
}

export type BookingState =
  | 'held'
  | 'requested'
  | 'confirmed'
  | 'expired'
  | 'declined'
  | 'withdrawn'
  | 'cancelled_by_passenger'
  | 'cancelled_by_driver'
  | 'completed'
  | 'rated';

export interface CancelQuote {
  refund_cents: number;
  kept_cents: number;
  percent: number;
  hours_before: number;
  reason: 'tier' | 'free_window';
}

export interface Booking {
  id: string;
  ride_id: string;
  passenger: Member;
  driver: Member;
  boarding: string;
  alighting: string;
  boarding_time: string;
  seats: number;
  seat_numbers: number[];
  segment_km: number;
  price_cents: number;
  state: BookingState;
  booking_mode: 'instant' | 'request';
  ride_state: Ride['state'];
  ride_version: number;
  ride_departure: string;
  ride_previous_departure: string | null;
  history: Array<{ state: string; at: string }>;
  hold_expires_at: string | null;
  expires_at: string | null;
  expires_in_seconds: number | null;
  free_cancel_until: string | null;
  cancel_quote: CancelQuote | null;
  paid_cents: number;
  refunded_cents: number;
  earned_cents: number;
  server_now: string;
}

export interface SearchRide {
  id: string;
  driver: Member;
  from: string;
  to: string;
  boarding_time: string;
  alighting_time: string;
  segment_km: number;
  segment_price_cents: number;
  seats_left: number;
  booking_mode: 'instant' | 'request';
  version: number;
}

export interface Notice {
  passenger_id: string;
  name: string;
  kind: 'time_change' | 'cancellation';
  status: 'queued' | 'sent';
  sent_at?: string | null;
}

export interface WalletLine {
  id: string;
  entry_id: string;
  label: string;
  amount_cents: number;
  at: string;
}

export interface RatingView {
  state: 'not_open' | 'open' | 'waiting' | 'revealed' | 'closed';
  mine: { stars: number; comment: string } | null;
  other_submitted: boolean;
  theirs: { stars: number; comment: string } | null;
  closes_at: string | null;
  server_now: string;
}

export interface Message {
  id: string;
  author_id: string;
  body: string;
  sent_at: string;
}

export interface Presence {
  member_id: string;
  online: boolean;
  last_seen_at: string | null;
}

export interface EarningsRow {
  booking_id: string;
  departure: string;
  from: string;
  to: string;
  passenger: string;
  seats: number;
  paid_cents: number;
  refunded_cents: number;
  earned_cents: number;
  status: string;
}
