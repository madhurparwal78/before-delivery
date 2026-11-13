import type { Booking, IdState, Ride } from "./api";
import type { SeatRow } from "./seats";

export type LiveEvent =
  | { type: "hello"; data: { server_now: string } }
  | { type: "seat"; data: { ride_id: string; seat_map: SeatRow[] } }
  | { type: "ride"; data: { ride: Ride } }
  | { type: "booking"; data: { booking: Booking } }
  | { type: "notice"; data: { ride_id: string; passenger_id: string; kind: "time_change" | "cancellation"; status: "queued" | "sent"; sent_at: string | null } }
  | { type: "message"; data: { booking_id: string; message: { id: string; author_id: string; body: string; sent_at: string } } }
  | { type: "presence"; data: { booking_id: string; member_id: string; online: boolean; last_seen_at: string | null } }
  | { type: "rating"; data: { booking_id: string; state: string } }
  | { type: "id_review"; data: { id_state: IdState; reason: string | null } }
  | { type: "wallet"; data: { balance_cents: number } }
  | { type: "clock"; data: { server_now: string } };

export type LiveEventType = LiveEvent["type"];
