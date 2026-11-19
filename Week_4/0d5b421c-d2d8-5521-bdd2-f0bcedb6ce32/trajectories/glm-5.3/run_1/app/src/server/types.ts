export type DateString = string;
export type TimeString = string;

export interface Booking {
  reference: string;
  status: "booked" | "seated" | "completed" | "no_show" | "cancelled_refunded" | "cancelled_retained";
  source: "online" | "waitlist" | "walk_in";
  date: DateString;
  time: TimeString;
  starts_at: string;
  party_size: number;
  table_id: string;
  room: string;
  name: string;
  deposit: { amount_cents: number; state: "none" | "paid" | "refunded" | "retained" };
  refund_cutoff: string | null;
}

export interface HoldResponse {
  hold_id: string;
  table_id: string;
  date: DateString;
  time: TimeString;
  party_size: number;
  status: "live" | "expired" | "released" | "confirmed";
  expires_at: string;
  server_now: string;
  deposit_cents: number;
}

export interface OfferResponse {
  status: "offered";
  date: DateString;
  time: TimeString;
  starts_at: string;
  party_size: number;
  table_id: string;
  room: string;
  expires_at: string;
  server_now: string;
  deposit_cents: number;
}

export interface SlotInfo {
  time: string;
  starts_at: string;
  bookable: boolean;
  reason: null | "too_late" | "past" | "beyond_horizon";
  covers_free: number;
  rooms: { room_id: string; covers_free: number }[];
  eligible_tables: number;
}

export interface AvailabilityResponse {
  date: DateString;
  party_size: number;
  server_now: string;
  slots: SlotInfo[];
}

export interface PlanTable {
  table_id: string;
  room_id: string;
  min_seats: number;
  max_seats: number;
  status: "fits" | "not_for_party" | "taken";
}

export interface PlanResponse {
  date: DateString;
  time: TimeString;
  party_size: number;
  tables: PlanTable[];
  pairs: { pair_id: string; status: "fits" | "not_for_party" | "taken" }[];
}

export interface RulesResponse {
  timezone: string;
  slot_times: string[];
  booking_lead_minutes: number;
  booking_horizon_days: number;
  hold_seconds: number;
  offer_seconds: number;
  turn_minutes: { "1-2": number; "3-4": number; "5-6": number; "7-8": number };
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
export interface FloorResponse {
  rooms: { room_id: string; name: string; seats: number; tables: FloorTable[] }[];
  joinable_pairs: { pair_id: string; tables: string[]; min_seats: number; max_seats: number }[];
}

export interface TonightResponse {
  date: DateString;
  server_now: string;
  next_slot: string | null;
  rooms: {
    room_id: string;
    name: string;
    seats: number;
    covers_free_at_next_slot: number | null;
    next_table_for_two: string | null;
  }[];
}

export interface StatusResponse {
  server_now: string;
  holds: "ok" | "paused";
  deposits: "ok" | "paused";
}

export interface WaitlistJoinResponse {
  entry_id: string;
  status: "waiting" | "offered" | "claimed" | "lapsed";
  position: number;
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

export interface HostFloorTable {
  table_id: string;
  room_id: string;
  status: "free" | "held" | "booked" | "seated" | "offered";
  joined_with: string | null;
  hold: { party_size: number; expires_at: string } | null;
  offer: { expires_at: string } | null;
  booking: Booking | null;
}

export interface HostFloorResponse {
  date: DateString;
  time: TimeString;
  server_now: string;
  totals: {
    covers_free: number;
    rooms: { room_id: string; name: string; seats: number; covers_free: number }[];
  };
  tables: HostFloorTable[];
}

export interface HostBookingsResponse {
  date: DateString;
  bookings: Booking[];
}

export interface HostSessionResponse {
  host: { email: string; name: string };
  expires_at: string;
}
