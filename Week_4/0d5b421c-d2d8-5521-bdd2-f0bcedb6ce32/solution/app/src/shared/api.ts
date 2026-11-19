// Wire types of the published API, shared by the server that builds them and the browser that renders them.

export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export type DepositState = "none" | "paid" | "refunded" | "retained";
export type BookingStatus = "booked" | "seated" | "completed" | "no_show" | "cancelled_refunded" | "cancelled_retained";
export type BookingSource = "online" | "waitlist" | "walk_in";

export interface Deposit {
  amount_cents: number;
  state: DepositState;
}

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
  deposit: Deposit;
  refund_cutoff: string | null;
}

export interface Rules {
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

interface FloorTable {
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
  tables: [string, string];
  min_seats: number;
  max_seats: number;
}

export interface FloorResponse {
  rooms: FloorRoom[];
  joinable_pairs: JoinablePair[];
}

export type DependencyState = "ok" | "paused";

export interface StatusResponse {
  server_now: string;
  holds: DependencyState;
  deposits: DependencyState;
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

export type SlotReason = "too_late" | "past";

export interface AvailabilitySlot {
  time: string;
  starts_at: string;
  bookable: boolean;
  reason: SlotReason | null;
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

export type PlanStatus = "fits" | "not_for_party" | "taken";

export interface PlanResponse {
  date: string;
  time: string;
  party_size: number;
  tables: { table_id: string; room_id: string; min_seats: number; max_seats: number; status: PlanStatus }[];
  pairs: { pair_id: string; status: PlanStatus }[];
}

export type HoldStatus = "live" | "expired" | "released" | "confirmed";

export interface HoldResponse {
  hold_id: string;
  table_id: string;
  date: string;
  time: string;
  party_size: number;
  status: HoldStatus;
  expires_at: string;
  server_now: string;
  deposit_cents: number;
}

export interface BookingReceipt {
  booking: Booking;
  manage_url: string;
}

export interface ManageResponse {
  booking: Booking;
  server_now: string;
  refund_if_cancelled_now: boolean;
}

export interface OfferResponse {
  status: "offered";
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

export interface WaitlistEntryResponse {
  entry_id: string;
  status: "waiting" | "offered" | "claimed" | "lapsed";
  position: number;
}

export type HostTableStatus = "free" | "held" | "booked" | "seated" | "offered";

export interface HostTable {
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
  totals: { covers_free: number; rooms: { room_id: string; name: string; seats: number; covers_free: number }[] };
  tables: HostTable[];
}

export interface HostSessionResponse {
  host: { email: string; name: string };
  expires_at: string;
}

export interface HostBookingsResponse {
  date: string;
  bookings: Booking[];
}

export type LiveEventType =
  | "hold.created"
  | "hold.released"
  | "hold.expired"
  | "booking.created"
  | "booking.cancelled"
  | "booking.seated"
  | "booking.completed"
  | "booking.no_show"
  | "walkin.seated"
  | "offer.created"
  | "offer.claimed"
  | "offer.lapsed";

export interface LiveEvent {
  type: LiveEventType;
  date: string;
  time: string;
  table_ids: string[];
  party_size: number;
}

export interface HostLiveEvent extends LiveEvent {
  reference?: string;
  name?: string;
  expires_at?: string;
}
