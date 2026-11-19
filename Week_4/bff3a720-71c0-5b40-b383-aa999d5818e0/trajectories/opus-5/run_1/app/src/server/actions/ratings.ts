import { randomUUID } from 'node:crypto';
import { now } from '../clock.js';
import { db, withTransaction, type Queryable } from '../db.js';
import { errors } from '../errors.js';
import { dateLabel } from '../../shared/zoned.js';
import { isoZoned } from '../domain/time.js';
import { ratingState, type RatingState } from '../domain/booking-rules.js';
import { mailCopy, queueEmail } from '../outbox.js';
import {
  boardingTimeOf,
  loadBooking,
  loadBookingForUpdate,
  loadMember,
  loadRide,
  loadRideForUpdate,
  type BookingRecord,
  type RideRecord,
} from '../model.js';
import { publishToMembers } from '../live.js';
import { publishBooking } from './shared.js';

export interface RatingRow {
  rater_id: string;
  subject_id: string;
  stars: number;
  comment: string;
}

async function ratingsOf(tx: Queryable, bookingId: string): Promise<RatingRow[]> {
  const { rows } = await tx.query<RatingRow>(
    'select rater_id, subject_id, stars, comment from ratings where booking_id = $1',
    [bookingId],
  );
  return rows;
}

export async function ratingView(
  bookingId: string,
  viewerId: string,
): Promise<Record<string, unknown>> {
  const at = now();
  const booking = (await loadBooking(db, bookingId)) as BookingRecord;
  const rows = await ratingsOf(db, bookingId);
  const state = ratingState({
    bookingState: booking.state,
    closesAt: booking.rating_closes_at,
    submitted: rows.length,
    at,
  });
  const mine = rows.find((row) => row.rater_id === viewerId) ?? null;
  const theirs = rows.find((row) => row.rater_id !== viewerId) ?? null;
  return {
    state,
    mine: mine ? { stars: mine.stars, comment: mine.comment } : null,
    other_submitted: theirs !== null,
    theirs:
      state === 'revealed' && theirs ? { stars: theirs.stars, comment: theirs.comment } : null,
    closes_at: booking.rating_closes_at ? isoZoned(booking.rating_closes_at) : null,
    server_now: isoZoned(at),
  };
}

/**
 * Both ratings are revealed together: the booking becomes `rated`, a rating event goes out
 * and the reveal email is queued for both parties.
 */
export async function revealRatings(
  tx: Queryable,
  booking: BookingRecord,
  ride: RideRecord,
  at: Date,
): Promise<string[]> {
  await tx.query('update bookings set state = $2, revealed_at = $3 where id = $1', [
    booking.id,
    'rated',
    at,
  ]);
  await tx.query('insert into booking_history (booking_id, state, at) values ($1, $2, $3)', [
    booking.id,
    'rated',
    at,
  ]);
  const copy = mailCopy.ratingsRevealed(
    ride.stops[booking.boarding_idx]?.city ?? '',
    ride.stops[booking.alighting_idx]?.city ?? '',
    dateLabel(isoZoned(boardingTimeOf(ride, booking.boarding_idx))),
  );
  const emailIds: string[] = [];
  for (const memberId of [booking.passenger_id, ride.driver_id]) {
    const member = await loadMember(tx, memberId);
    emailIds.push(
      await queueEmail(tx, {
        kind: 'ratings_revealed',
        to: member?.email ?? '',
        subject: copy.subject,
        body: copy.body,
        bookingId: booking.id,
        memberId,
      }),
    );
  }
  return emailIds;
}

export function publishRating(
  booking: BookingRecord,
  driverId: string,
  state: RatingState,
): void {
  publishToMembers([booking.passenger_id, driverId], 'rating', {
    booking_id: booking.id,
    state,
  });
}

export async function submitRating(
  bookingId: string,
  raterId: string,
  stars: unknown,
  comment: unknown,
): Promise<{ revealed: boolean }> {
  const result = await withTransaction(async (tx) => {
    const at = now();
    const booking = await loadBookingForUpdate(tx, bookingId);
    if (!booking) throw errors.notFound();
    const ride = await loadRideForUpdate(tx, booking.ride_id);
    if (!ride) throw errors.notFound();
    const isPassenger = booking.passenger_id === raterId;
    const isDriver = ride.driver_id === raterId;
    if (!isPassenger && !isDriver) throw errors.notFound();

    const rows = await ratingsOf(tx, bookingId);
    const state = ratingState({
      bookingState: booking.state,
      closesAt: booking.rating_closes_at,
      submitted: rows.length,
      at,
    });
    if (rows.some((row) => row.rater_id === raterId)) throw errors.alreadyRated();
    if (state === 'not_open') throw errors.ratingNotOpen();
    if (state === 'closed' || state === 'revealed') throw errors.ratingClosed();

    const fields: Record<string, string> = {};
    const starValue = typeof stars === 'number' && Number.isInteger(stars) ? stars : -1;
    if (starValue < 1 || starValue > 5) fields.stars = 'Choose 1 to 5 stars.';
    const text = typeof comment === 'string' ? comment : '';
    if (text.length > 280) fields.comment = 'Keep the comment to 280 characters.';
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

    await tx.query(
      `insert into ratings (id, booking_id, rater_id, subject_id, stars, comment, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        bookingId,
        raterId,
        isPassenger ? ride.driver_id : booking.passenger_id,
        starValue,
        text,
        at,
      ],
    );

    const revealed = rows.length + 1 === 2;
    const emailIds = revealed ? await revealRatings(tx, booking, ride, at) : [];
    return { booking, ride, revealed, emailIds };
  });

  publishRating(
    result.booking,
    result.ride.driver_id,
    result.revealed ? 'revealed' : 'waiting',
  );
  if (result.revealed) await publishBooking(bookingId);
  return { revealed: result.revealed };
}
