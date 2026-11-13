import type { SeatRow } from "./seats";

export type IdState = "none" | "pending" | "verified" | "rejected";
export type Role = "driver" | "passenger" | "founder";

export interface Rating {
  average: number | null;
  count: number;
}

export interface Member {
  id: string;
  display_name: string;
  roles: Role[];
  id_state: IdState;
  photo_url: string | null;
  rating: Rating;
  email?: string;
  wallet_cents?: number;
}

export type RideState = "published" | "changed" | "departed" | "arrived" | "cancelled";
export type BookingMode = "instant" | "request";

export interface Stop {
  city: string;
  km: number;
  time: string;
}

export interface Leg {
  index: number;
  from: string;
  to: string;
  km: number;
}

export interface Vehicle {
  id: string;
  make_model: string;
  colour: string;
  seats: number;
}

export interface Ride {
  id: string;
  state: RideState;
  version: number;
  driver: Member;
  vehicle: Vehicle;
  booking_mode: BookingMode;
  seats: number;
  price_cents: number;
  route_km: number;
  stops: Stop[];
  legs: Leg[];
  seat_map: SeatRow[];
  server_now: string;
}

export type BookingState =
  | "held"
  | "requested"
  | "accepted"
  | "confirmed"
  | "declined"
  | "expired"
  | "withdrawn"
  | "cancelled_by_passenger"
  | "cancelled_by_driver"
  | "completed"
  | "rated";

export interface CancelQuote {
  refund_cents: number;
  kept_cents: number;
  percent: number;
  hours_before: number;
  reason: "tier" | "free_window";
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
  history: { state: BookingState; at: string }[];
  hold_expires_at: string | null;
  expires_at: string | null;
  expires_in_seconds: number | null;
  free_cancel_until: string | null;
  cancel_quote: CancelQuote | null;
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
  booking_mode: BookingMode;
  version: number;
}

export interface Notice {
  passenger_id: string;
  name: string;
  kind: "time_change" | "cancellation";
  status: "queued" | "sent";
  sent_at?: string | null;
}

export interface RideChange {
  ride: Ride;
  notices: Notice[];
}

interface WalletLine {
  id: string;
  entry_id: string;
  label: string;
  amount_cents: number;
  at: string;
}

export interface Wallet {
  balance_cents: number;
  lines: WalletLine[];
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

export type RatingState = "not_open" | "open" | "waiting" | "revealed" | "closed";

export interface BookingRating {
  state: RatingState;
  mine: { stars: number; comment: string } | null;
  other_submitted: boolean;
  theirs: { stars: number; comment: string } | null;
  closes_at: string;
  server_now: string;
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
  status: BookingState;
}

export interface Earnings {
  month: string;
  rows: EarningsRow[];
  total_earned_cents: number;
}

export interface IdDocumentState {
  id_state: IdState;
  reason: string | null;
  file_id: string | null;
}

export interface IdReview {
  id: string;
  member: Member;
  file_id: string;
  uploaded_at: string;
}

export interface OutboxItem {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: "queued" | "sent";
  attempts: number;
  last_attempt_at: string | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  ride?: Ride;
}

export interface CitiesReply {
  cities: string[];
  distances: { from: string; to: string; km: number }[];
  server_now: string;
}

export interface PriceRange {
  route_km: number;
  low_cents: number;
  high_cents: number;
}

/** A booking plus the last departure change that affected it (null when none did). */
export type BookingWithChange = Booking & { ride_change: { from_time: string; to_time: string } | null };

/** Everything the server hands the page besides API data. */
export interface PageConfig {
  toastSeconds: number;
  searchDebounceMs: number;
}
