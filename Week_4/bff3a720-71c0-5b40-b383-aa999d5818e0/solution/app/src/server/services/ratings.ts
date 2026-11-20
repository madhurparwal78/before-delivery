import { isoBrussels } from "../../shared/time";
import type { BookingRating } from "../../shared/api";
import { now } from "../clock";
import type { Db, TxHandle } from "../db";
import { ratingState, ratingWindowCloses } from "../domain/ratings";
import { apiErrors } from "../http/errors";
import { moveTo } from "./bookings";
import { emails } from "./emails";
import { emitBooking, emitRating } from "./events";
import { enqueue } from "./outbox";
import { arrivalOf } from "../domain/route";
import { boardingTimeOf, getMemberRow, spanCities, type BookingRow, type MemberRow, type RideRecord } from "./views";

interface RatingRow {
  by_member_id: string;
  stars: number;
  comment: string;
}

async function ratingsOf(db: Db, bookingId: string): Promise<RatingRow[]> {
  const { rows } = await db.query<RatingRow>("SELECT by_member_id, stars, comment FROM ratings WHERE booking_id = $1", [bookingId]);
  return rows;
}

function stateOf(ride: RideRecord, booking: BookingRow, submitted: number, at: Date) {
  const arrival = arrivalOf(ride.route);
  return ratingState({ revealed: booking.state === "rated", arrived: at.getTime() >= arrival.getTime(), arrival, now: at, submitted });
}

export async function ratingView(db: Db, ride: RideRecord, booking: BookingRow, viewerId: string): Promise<BookingRating> {
  const at = now();
  const given = await ratingsOf(db, booking.id);
  const state = stateOf(ride, booking, given.length, at);
  const mine = given.find((r) => r.by_member_id === viewerId);
  const theirs = given.find((r) => r.by_member_id !== viewerId);
  return {
    state,
    mine: mine ? { stars: mine.stars, comment: mine.comment } : null,
    other_submitted: Boolean(theirs),
    theirs: state === "revealed" && theirs ? { stars: theirs.stars, comment: theirs.comment } : null,
    closes_at: isoBrussels(ratingWindowCloses(arrivalOf(ride.route))),
    server_now: isoBrussels(at),
  };
}

/** Both ratings in, or the window closed with at least one: reveal together, once. */
async function revealRatings(db: TxHandle, ride: RideRecord, booking: BookingRow): Promise<void> {
  await moveTo(db, booking, "rated", now());
  const span = spanCities(ride, booking);
  const trip = { ...span, boardingTime: boardingTimeOf(ride, booking) };
  for (const memberId of [booking.passenger_id, ride.row.driver_id]) {
    const member = (await getMemberRow(db, memberId)) as MemberRow;
    await enqueue(db, emails.ratingsRevealed(member.email, member.display_name, trip));
  }
  db.afterCommit(async () => {
    await emitRating(booking.id, "revealed");
    await emitBooking(booking.id);
  });
}

export function ratingConflicts(ride: RideRecord, booking: BookingRow, submittedBy: string[], viewerId: string): void {
  const at = now();
  if (booking.state !== "completed" && booking.state !== "confirmed" && booking.state !== "rated") throw apiErrors.invalidTransition();
  if (at.getTime() < arrivalOf(ride.route).getTime()) throw apiErrors.ratingNotOpen();
  if (submittedBy.includes(viewerId)) throw apiErrors.alreadyRated();
  if (at.getTime() >= ratingWindowCloses(arrivalOf(ride.route)).getTime() || booking.state === "rated") throw apiErrors.ratingClosed();
}

export async function raterIds(db: Db, bookingId: string): Promise<string[]> {
  return (await ratingsOf(db, bookingId)).map((r) => r.by_member_id);
}

/** Decide what the ratings of a booking mean now: reveal together, mark closed, or wait. */
export async function settleRatings(db: TxHandle, ride: RideRecord, booking: BookingRow): Promise<void> {
  const state = stateOf(ride, booking, (await ratingsOf(db, booking.id)).length, now());
  if (state === "revealed" && booking.state === "completed") {
    await revealRatings(db, ride, booking);
  } else if (state === "closed" && !booking.rating_closed) {
    await db.query("UPDATE bookings SET rating_closed = true WHERE id = $1", [booking.id]);
    db.afterCommit(() => emitRating(booking.id, "closed"));
  } else if (state === "waiting") {
    db.afterCommit(() => emitRating(booking.id, "waiting"));
  }
}

export async function submitRating(db: TxHandle, ride: RideRecord, booking: BookingRow, byId: string, stars: number, comment: string, ratingId: string): Promise<void> {
  await db.query("INSERT INTO ratings (id, booking_id, by_member_id, stars, comment, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [ratingId, booking.id, byId, stars, comment, now()]);
  await settleRatings(db, ride, booking);
}
