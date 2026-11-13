import { UNARRIVED_RIDE_STATES } from "../domain/rideStates";
import { now } from "../clock";
import type { TxHandle } from "../db";
import { arrivalOf } from "../domain/route";
import { completeBooking } from "./bookings";
import { emitRide } from "./events";
import { loadRide, type BookingRow, type RideRecord } from "./views";

/** Departure and arrival of one ride, decided here for the sweep and for any request that needs fresh state. */
export async function advanceRide(db: TxHandle, rideId: string): Promise<RideRecord | undefined> {
  const ride = await loadRide(db, rideId, true);
  if (!ride) return undefined;
  const at = now();
  const { state } = ride.row;
  if (!UNARRIVED_RIDE_STATES.includes(state)) return ride;
  const arrived = at.getTime() >= arrivalOf(ride.route).getTime();
  const departed = at.getTime() >= ride.row.departure.getTime();
  if (!departed) return ride;
  const next = arrived ? "arrived" : "departed";
  if (next === state) return ride;
  await db.query("UPDATE rides SET state = $2 WHERE id = $1", [rideId, next]);
  ride.row.state = next;
  if (arrived) {
    const { rows } = await db.query<BookingRow>("SELECT * FROM bookings WHERE ride_id = $1 AND state = 'confirmed' ORDER BY created_at, id FOR UPDATE", [rideId]);
    for (const booking of rows) await completeBooking(db, ride, booking);
  }
  db.afterCommit(() => emitRide(rideId));
  return ride;
}
