export type BookingStatus =
  | 'booked'
  | 'seated'
  | 'completed'
  | 'no_show'
  | 'cancelled_refunded'
  | 'cancelled_retained';

export type BookingSource = 'online' | 'waitlist' | 'walk_in';

export type DepositState = 'none' | 'paid' | 'refunded' | 'retained';

export interface Booking {
  reference: string;
  status: BookingStatus;
  source: BookingSource;
  date: string;
  time: string;
  starts_at: string;
  party_size: number;
  table_id: string;
  room: string;
  name: string;
  deposit: { amount_cents: number; state: DepositState };
  refund_cutoff: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface StatusResponse {
  server_now: string;
  holds: 'ok' | 'paused';
  deposits: 'ok' | 'paused';
}

export interface RulesResponse {
  timezone: string;
  slot_times: string[];
  booking_lead_minutes: number;
  booking_horizon_days: number;
  hold_seconds: number;
  offer_seconds: number;
  turn_minutes: Record<string, number>;
  reset_minutes: number;
  deposit_cents_per_cover: number;
  deposit_min_party: number;
  deposit_rooms: string[];
  refund_cutoff_hours: number;
  no_show_after_minutes: number;
  host_session_hours: number;
}

export interface FloorTable {
  table_id: string;
  min_seats: number;
  max_seats: number;
}

export interface FloorRoom {
  room_id: string;
  name: string;
  seats: number;
  tables: FloorTable[];
}

export interface JoinablePair {
  pair_id: string;
  tables: string[];
  min_seats: number;
  max_seats: number;
}

export interface FloorResponse {
  rooms: FloorRoom[];
  joinable_pairs: JoinablePair[];
}

export interface TonightRoom {
  room_id: string;
  name: string;
  seats: number;
  covers_free_at_next_slot: number | null;
  next_table_for_two: string | null;
}

export interface TonightResponse {
  date: string;
  server_now: string;
  next_slot: string | null;
  rooms: TonightRoom[];
}

export type SlotReason = null | 'too_late' | 'past' | 'beyond_horizon';

export interface AvailabilitySlot {
  time: string;
  starts_at: string;
  bookable: boolean;
  reason: SlotReason;
  covers_free: number;
  rooms: { room_id: string; covers_free: number }[];
  eligible_tables: number;
}

export interface AvailabilityResponse {
  date: string;
  party_size: number;
  server_now: string;
  slots: AvailabilitySlot[];
}

export type PlanTableStatus = 'fits' | 'not_for_party' | 'taken';

export interface PlanTable {
  table_id: string;
  room_id: string;
  min_seats: number;
  max_seats: number;
  status: PlanTableStatus;
}

export interface PlanResponse {
  date: string;
  time: string;
  party_size: number;
  tables: PlanTable[];
  pairs: { pair_id: string; status: PlanTableStatus }[];
}

export interface HoldResponse {
  hold_id: string;
  table_id: string;
  date: string;
  time: string;
  party_size: number;
  status: 'live' | 'expired' | 'released' | 'confirmed';
  expires_at: string;
  server_now: string;
  deposit_cents: number;
}

export interface ConfirmResponse {
  booking: Booking;
  manage_url: string;
}

export interface ManageResponse {
  booking: Booking;
  server_now: string;
  refund_if_cancelled_now: boolean;
}

export interface WaitlistResponse {
  entry_id: string;
  status: string;
  position: number;
}

export interface OfferResponse {
  status: 'offered';
  date: string;
  time: string;
  starts_at: string;
  party_size: number;
  table_id: string;
  room: string;
  expires_at: string;
  server_now: string;
  deposit_cents: number;
}

export type HostTableStatus = 'free' | 'held' | 'booked' | 'seated' | 'offered';

export interface HostFloorTable {
  table_id: string;
  room_id: string;
  status: HostTableStatus;
  joined_with: string | null;
  hold: { party_size: number; expires_at: string } | null;
  offer: { expires_at: string } | null;
  booking: Booking | null;
}

export interface HostFloorResponse {
  date: string;
  time: string;
  server_now: string;
  totals: {
    covers_free: number;
    rooms: {
      room_id: string;
      name: string;
      seats: number;
      covers_free: number;
    }[];
  };
  tables: HostFloorTable[];
}

export interface HostBookingsResponse {
  date: string;
  bookings: Booking[];
}

export interface HostSessionResponse {
  host: { email: string; name: string };
  expires_at: string;
}

export type LiveEventType =
  | 'hold.created'
  | 'hold.released'
  | 'hold.expired'
  | 'booking.created'
  | 'booking.cancelled'
  | 'booking.seated'
  | 'booking.completed'
  | 'booking.no_show'
  | 'walkin.seated'
  | 'offer.created'
  | 'offer.claimed'
  | 'offer.lapsed';

export interface PublicLiveEvent {
  type: LiveEventType;
  date: string;
  time: string;
  table_ids: string[];
  party_size: number;
}

export interface HostLiveEvent extends PublicLiveEvent {
  reference: string | null;
  name: string | null;
  expires_at: string | null;
}
