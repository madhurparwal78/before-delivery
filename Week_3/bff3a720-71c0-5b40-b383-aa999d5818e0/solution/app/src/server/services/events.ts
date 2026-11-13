import { isOpenRide } from "../domain/rideStates";
import { isoBrussels } from "../../shared/time";
import { pool } from "../db";
import { publish } from "./live";
import { bookingView, getMemberRow, loadBooking, loadRide, rideView, seatMapOf, serverNow } from "./views";
import { walletBalance } from "./ledger";

/** Tell the passenger and the driver about a booking, each with the view they are allowed to see. */
export async function emitBooking(bookingId: string): Promise<void> {
  const booking = await loadBooking(pool, bookingId);
  if (!booking) return;
  const ride = await loadRide(pool, booking.ride_id);
  if (!ride) return;
  for (const viewer of new Set([booking.passenger_id, ride.row.driver_id])) {
    await publish({
      event: { type: "booking", data: { booking: await bookingView(pool, booking, ride, viewer) } },
      audience: { members: [viewer] },
    });
  }
}

export async function emitSeats(rideId: string): Promise<void> {
  const ride = await loadRide(pool, rideId);
  if (!ride) return;
  await publish({ event: { type: "seat", data: { ride_id: rideId, seat_map: await seatMapOf(pool, ride) } }, audience: { ride: rideId } });
}

/** A ride change reaches the driver, its passengers, and anyone watching while the ride is still public. */
export async function emitRide(rideId: string): Promise<void> {
  const ride = await loadRide(pool, rideId);
  if (!ride) return;
  const { rows } = await pool.query<{ passenger_id: string }>("SELECT DISTINCT passenger_id FROM bookings WHERE ride_id = $1", [rideId]);
  const isPublic = isOpenRide(ride.row.state);
  await publish({
    event: { type: "ride", data: { ride: await rideView(pool, ride) } },
    audience: { members: [ride.row.driver_id, ...rows.map((r) => r.passenger_id)], ...(isPublic ? { ride: rideId } : {}) },
  });
}

export async function emitWallet(memberId: string): Promise<void> {
  await publish({ event: { type: "wallet", data: { balance_cents: await walletBalance(pool, memberId) } }, audience: { members: [memberId] } });
}

export async function emitNotice(rideId: string, passengerId: string, kind: "time_change" | "cancellation", status: "queued" | "sent", sentAt: Date | null): Promise<void> {
  const ride = await loadRide(pool, rideId);
  if (!ride) return;
  await publish({
    event: { type: "notice", data: { ride_id: rideId, passenger_id: passengerId, kind, status, sent_at: sentAt ? isoBrussels(sentAt) : null } },
    audience: { members: [ride.row.driver_id] },
  });
}

export async function emitRating(bookingId: string, state: string): Promise<void> {
  const booking = await loadBooking(pool, bookingId);
  if (!booking) return;
  const ride = await loadRide(pool, booking.ride_id);
  if (!ride) return;
  await publish({ event: { type: "rating", data: { booking_id: bookingId, state } }, audience: { members: [booking.passenger_id, ride.row.driver_id] } });
}

export async function emitIdReview(memberId: string): Promise<void> {
  const member = await getMemberRow(pool, memberId);
  if (!member) return;
  await publish({ event: { type: "id_review", data: { id_state: member.id_state, reason: member.id_reason } }, audience: { members: [memberId] } });
}

export async function emitClock(): Promise<void> {
  await publish({ event: { type: "clock", data: { server_now: serverNow() } }, audience: { all: true } });
}

export async function emitMessage(bookingId: string, message: { id: string; author_id: string; body: string; sent_at: Date }): Promise<void> {
  const booking = await loadBooking(pool, bookingId);
  if (!booking) return;
  const ride = await loadRide(pool, booking.ride_id);
  if (!ride) return;
  await publish({
    event: { type: "message", data: { booking_id: bookingId, message: { ...message, sent_at: isoBrussels(message.sent_at) } } },
    audience: { thread: { id: bookingId, members: [booking.passenger_id, ride.row.driver_id] } },
  });
}

