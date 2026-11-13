export interface MemberRating { average: number | null; count: number }

export interface Member {
  id: string;
  display_name: string;
  roles: string[];
  id_state: 'none' | 'pending' | 'verified' | 'rejected';
  photo_url: string | null;
  rating: MemberRating;
  email?: string;
  wallet_cents?: number;
}

export interface Stop { city: string; km: number; time: string }
export interface Leg { index: number; from: string; to: string; km: number }
export interface SeatRow { seat: number; legs: string[] }

export interface Vehicle { id: string; make_model: string; colour: string; seats: number }

export interface Ride {
  id: string;
  state: 'published' | 'changed' | 'departed' | 'arrived' | 'cancelled';
  version: number;
  driver: Member;
  vehicle: { id: string; make_model: string; colour: string; seats: number } | null;
  booking_mode: 'instant' | 'request';
  seats: number;
  price_cents: number;
  route_km: number;
  stops: Stop[];
  legs: Leg[];
  seat_map: SeatRow[];
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
  alighting_time: string;
  seats: number;
  seat_numbers: number[];
  segment_km: number;
  price_cents: number;
  state: string;
  history: Array<{ state: string; at: string }>;
  hold_expires_at: string | null;
  expires_at: string | null;
  expires_in_seconds: number | null;
  free_cancel_until: string | null;
  cancel_quote: CancelQuote | null;
  server_now: string;
}

export interface WalletLine { id: string; entry_id: string; label: string; amount_cents: number; at: string }

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

export interface Message { id: string; author_id: string; body: string; sent_at: string }
export interface Presence { member_id: string; online: boolean; last_seen_at: string | null }

export interface RatingState {
  state: 'not_open' | 'open' | 'waiting' | 'revealed' | 'closed';
  mine: { stars: number; comment: string } | null;
  other_submitted: boolean;
  theirs: { stars: number; comment: string } | null;
  closes_at: string;
  server_now: string;
}

export interface Notice { passenger_id: string; name: string; kind: 'time_change' | 'cancellation'; status: 'queued' | 'sent'; sent_at: string | null }

export interface OutboxItem { id: string; kind: string; to: string; subject: string; status: 'queued' | 'sent'; attempts: number; last_attempt_at: string | null }

export interface ApiErrorBody { error: string; message: string; fields?: Record<string, string>; ride?: Ride }
