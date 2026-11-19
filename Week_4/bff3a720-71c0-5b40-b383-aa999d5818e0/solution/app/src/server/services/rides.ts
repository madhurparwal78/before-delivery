import { assignSeats } from "../../shared/seats";
import type { BookingMode } from "../../shared/api";
import type { City } from "../../shared/towns";
import { now } from "../clock";
import { newId, type TxHandle } from "../db";
import { freeCancelUntil, qualifiesForFreeWindow } from "../domain/refunds";
import { clearRequestDeadline, setRequestDeadline } from "../valkey";
import { expireHold, moveTo, tripLabel } from "./bookings";
import { emails } from "./emails";
import { emitBooking, emitRide, emitSeats, emitWallet } from "./events";
import { recordDriverCancellation, recordRequestRelease } from "./ledger";
import { enqueue } from "./outbox";
import {
  deadlineOf, getMemberRow, loadRide, seatMapOf, takesSeats,
  type BookingRow, type MemberRow, type RideRecord,
} from "./views";

interface NewRide {
  driverId: string;
  vehicleId: string;
  cities: City[];
  departure: Date;
  seats: number;
  priceCents: number;
  bookingMode: BookingMode;
}

export async function insertRide(db: TxHandle, input: NewRide, state: "published" | "changed" | "departed" | "arrived" | "cancelled" = "published"): Promise<RideRecord> {
  const id = newId();
  await db.query(
    `INSERT INTO rides (id, driver_id, vehicle_id, booking_mode, seats, price_cents, state, version, departure, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9)`,
    [id, input.driverId, input.vehicleId, input.bookingMode, input.seats, input.priceCents, state, input.departure, now()],
  );
  for (const [position, city] of input.cities.entries()) {
    await db.query("INSERT INTO ride_stops (ride_id, position, city) VALUES ($1, $2, $3)", [id, position, city]);
  }
  return (await loadRide(db, id)) as RideRecord;
}

/** Most seats used on any one leg by bookings that take seats now. */
async function mostSeatsUsed(db: TxHandle, ride: RideRecord): Promise<number> {
  const map = await seatMapOf(db, ride, now());
  const legCount = ride.route.cities.length - 1;
  let most = 0;
  for (let leg = 0; leg < legCount; leg += 1) most = Math.max(most, map.filter((row) => row.legs[leg] === "taken").length);
  return most;
}

export interface EditPatch {
  departure?: Date;
  seats?: number;
}

/** Field messages for a driver edit: seats between the busiest leg and the car, a departure later than now. */
export async function editProblems(db: TxHandle, ride: RideRecord, carSeats: number, patch: EditPatch): Promise<Record<string, string>> {
  const problems: Record<string, string> = {};
  if (patch.seats !== undefined) {
    const used = await mostSeatsUsed(db, ride);
    if (patch.seats > carSeats) problems.seats = "Seats cannot be more than the car has.";
    else if (patch.seats < used) problems.seats = `Seats cannot go below the ${used} already taken on one leg.`;
  }
  if (patch.departure !== undefined && patch.departure.getTime() <= now().getTime()) problems.departure = "Choose a time later than now.";
  return problems;
}

/** Re-pack seat numbers greedily by boarding order when lowering seats would orphan a high seat number. */
async function repackSeats(db: TxHandle, ride: RideRecord, seatCount: number): Promise<void> {
  const { rows } = await db.query<BookingRow>(
    "SELECT * FROM bookings WHERE ride_id = $1 ORDER BY boarding_index, created_at, id",
    [ride.row.id],
  );
  const at = now();
  const active = rows.filter((b) => takesSeats(b, at));
  if (!active.some((b) => b.seat_numbers.some((seat) => seat > seatCount))) return;
  const legCount = ride.route.cities.length - 1;
  const map = Array.from({ length: seatCount }, (_, index) => ({ seat: index + 1, legs: Array<"free" | "taken">(legCount).fill("free") }));
  for (const booking of active) {
    const seats = assignSeats(map, booking.boarding_index, booking.alighting_index, booking.seats) as number[];
    for (const seat of seats) for (let leg = booking.boarding_index; leg < booking.alighting_index; leg += 1) (map[seat - 1] as { legs: ("free" | "taken")[] }).legs[leg] = "taken";
    await db.query("UPDATE bookings SET seat_numbers = $2 WHERE id = $1", [booking.id, seats]);
  }
}

async function affectedBookings(db: TxHandle, rideId: string, states: string[]): Promise<BookingRow[]> {
  const { rows } = await db.query<BookingRow>("SELECT * FROM bookings WHERE ride_id = $1 AND state = ANY($2) ORDER BY created_at, id", [rideId, states]);
  return rows;
}

/** Apply a validated driver edit: version +1, state changed, and for a time change one email per affected passenger. */
export async function applyEdit(db: TxHandle, ride: RideRecord, driver: MemberRow, patch: EditPatch): Promise<{ outboxIds: string[] }> {
  const oldDeparture = ride.row.departure;
  const newDeparture = patch.departure ?? oldDeparture;
  const newSeats = patch.seats ?? ride.row.seats;
  await db.query("UPDATE rides SET departure = $2, seats = $3, version = version + 1, state = 'changed' WHERE id = $1", [ride.row.id, newDeparture, newSeats]);
  if (newSeats !== ride.row.seats) await repackSeats(db, ride, newSeats);
  const outboxIds: string[] = [];
  const updated = (await loadRide(db, ride.row.id)) as RideRecord;
  const moved = newDeparture.getTime() !== oldDeparture.getTime();
  const bookings = moved ? await affectedBookings(db, ride.row.id, ["confirmed", "requested"]) : [];
  if (moved) {
    const qualifies = qualifiesForFreeWindow(oldDeparture, newDeparture);
    const until = qualifies ? freeCancelUntil(newDeparture) : null;
    const emailed = new Set<string>();
    for (const booking of bookings) {
      const window = until ?? booking.free_cancel_until;
      await db.query("UPDATE bookings SET change_from = $2, change_to = $3, free_cancel_until = $4 WHERE id = $1", [booking.id, oldDeparture, newDeparture, window]);
      if (emailed.has(booking.passenger_id)) continue;
      emailed.add(booking.passenger_id);
      const passenger = (await getMemberRow(db, booking.passenger_id)) as MemberRow;
      outboxIds.push(await enqueue(db, emails.timeChange(passenger.email, passenger.display_name, passenger.id, ride.row.id, driver.display_name, oldDeparture, newDeparture, until), false));
    }
  }
  db.afterCommit(async () => {
    await emitRide(ride.row.id);
    await emitSeats(ride.row.id);
    for (const booking of bookings) await emitBooking(booking.id);
    for (const booking of bookings) {
      if (booking.state === "requested") await setRequestDeadline(booking.id, deadlineOf(updated, booking).getTime());
    }
  });
  return { outboxIds };
}

/** Driver cancellation: 100% back to every confirmed booking and pending request, one email per passenger. */
export async function cancelRide(db: TxHandle, ride: RideRecord, driver: MemberRow): Promise<{ outboxIds: string[] }> {
  const at = now();
  await db.query("UPDATE rides SET state = 'cancelled', version = version + 1 WHERE id = $1", [ride.row.id]);
  const bookings = await affectedBookings(db, ride.row.id, ["confirmed", "requested", "held"]);
  const refunded = new Map<string, number>();
  for (const booking of bookings) {
    if (booking.state === "held") {
      await expireHold(db, ride, booking);
    } else if (booking.state === "confirmed") {
      await moveTo(db, booking, "cancelled_by_driver", at);
      await recordDriverCancellation(db, booking.id, booking.passenger_id, driver.id, booking.price_cents, `Refund 100%: ${tripLabel(ride, booking)}`, at);
      refunded.set(booking.passenger_id, (refunded.get(booking.passenger_id) ?? 0) + booking.price_cents);
    } else {
      await moveTo(db, booking, "withdrawn", at);
      await recordRequestRelease(db, booking.id, booking.passenger_id, booking.price_cents, `Request withdrawn: ${tripLabel(ride, booking)}`, at);
      refunded.set(booking.passenger_id, (refunded.get(booking.passenger_id) ?? 0) + booking.price_cents);
    }
  }
  const outboxIds: string[] = [];
  for (const [passengerId, cents] of refunded) {
    const passenger = (await getMemberRow(db, passengerId)) as MemberRow;
    outboxIds.push(await enqueue(db, emails.cancellation(passenger.email, passenger.display_name, passenger.id, ride.row.id, ride.route.times[0] as Date, cents), false));
  }
  db.afterCommit(async () => {
    await emitRide(ride.row.id);
    await emitSeats(ride.row.id);
    for (const booking of bookings) {
      await emitBooking(booking.id);
      await clearRequestDeadline(booking.id);
    }
    for (const passengerId of refunded.keys()) await emitWallet(passengerId);
  });
  return { outboxIds };
}

