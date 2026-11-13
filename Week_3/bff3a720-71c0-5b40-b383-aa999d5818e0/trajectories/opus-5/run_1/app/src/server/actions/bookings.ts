import { segmentPriceCents } from '../../shared/pricing.js';
import { randomUUID } from 'node:crypto';
import { now } from '../clock.js';
import { db, withTransaction, type Queryable } from '../db.js';
import { errors } from '../errors.js';
import { money } from '../../shared/format.js';
import { dateLabel } from '../../shared/zoned.js';
import { isoZoned } from '../domain/time.js';
import {
  bookingClosed,
  bookingCutoffMinutes,
  holdDeadline,
  requestDeadline,
} from '../domain/booking-rules.js';
import { cancelQuote } from '../domain/booking-rules.js';

import { assignSeats, buildSeatMap } from '../../shared/seats.js';
import * as ledger from '../domain/ledger.js';
import { walletBalance } from '../domain/ledger.js';
import { mailCopy, queueEmail } from '../outbox.js';
import {
  activeClaims,
  boardingTimeOf,
  legCountOf,
  loadBooking,
  loadBookingForUpdate,
  loadMember,
  loadRideForUpdate,
  rideBookings,
  serialiseBooking,
  serialiseRide,
  type BookingRecord,
  type RideRecord,
} from '../model.js';
import {
  dropHoldKeys,
  publishBooking,
  publishSeatMap,
  publishWallet,
  recordState,
  spanLabel,
  trackRequestDeadline,
  untrackRequestDeadline,
  writeHoldKeys,
} from './shared.js';

export interface CreateBookingInput {
  rideId: string;
  passengerId: string;
  boarding: unknown;
  alighting: unknown;
  seats: unknown;
  rideVersion: unknown;
  missingIdempotencyKey: boolean;
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return null;
}

/** Place a hold (instant) or a request, deciding the seat race under the ride's row lock. */
export async function createBooking(
  input: CreateBookingInput,
): Promise<Record<string, unknown>> {
  const result = await withTransaction(async (tx) => {
    const at = now();
    const ride = await loadRideForUpdate(tx, input.rideId);
    if (!ride) throw errors.notFound();
    if (ride.driver_id === input.passengerId) throw errors.forbidden();

    const fields: Record<string, string> = {};
    const boardingIdx =
      typeof input.boarding === 'string'
        ? ride.stops.findIndex((stop) => stop.city === input.boarding)
        : -1;
    const alightingIdx =
      typeof input.alighting === 'string'
        ? ride.stops.findIndex((stop) => stop.city === input.alighting)
        : -1;
    if (boardingIdx < 0) fields.boarding = 'Choose a stop on this ride.';
    if (alightingIdx < 0) fields.alighting = 'Choose a stop on this ride.';
    if (boardingIdx >= 0 && alightingIdx >= 0 && boardingIdx >= alightingIdx) {
      fields.alighting = 'Choose a stop later than where you board.';
    }
    const seats = asInteger(input.seats);
    if (seats === null || seats < 1 || seats > 4) fields.seats = 'Choose 1 to 4 seats.';
    const rideVersion = asInteger(input.rideVersion);
    if (rideVersion === null) fields.ride_version = 'Send the ride version you are booking.';
    if (input.missingIdempotencyKey) {
      fields.idempotency_key = 'Send an Idempotency-Key header.';
    }

    if (rideVersion !== null && rideVersion !== ride.version) {
      throw errors.rideChanged(await serialiseRide(tx, ride, at));
    }

    const spanIsSound = boardingIdx >= 0 && alightingIdx > boardingIdx;
    if (spanIsSound) {
      const boardingTime = boardingTimeOf(ride, boardingIdx);
      if (bookingClosed(ride.booking_mode, boardingTime, at)) {
        throw errors.bookingClosed(bookingCutoffMinutes(ride.booking_mode));
      }
    }

    let assigned: number[] | null = null;
    if (spanIsSound && seats !== null && seats >= 1 && seats <= 4) {
      const existing = await rideBookings(tx, ride.id);
      const seatMap = buildSeatMap(ride.seats, legCountOf(ride), activeClaims(existing, at));
      assigned = assignSeats(seatMap, boardingIdx, alightingIdx, seats);
      if (!assigned) throw errors.seatTaken();
    }

    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
    if (!assigned || seats === null) throw errors.seatTaken();

    const segKm =
      (ride.stops[alightingIdx]?.km ?? 0) - (ride.stops[boardingIdx]?.km ?? 0);
    const perSeat = segmentPriceCents(ride.price_cents, segKm, ride.route_km);
    const priceCents = perSeat * seats;

    const isRequest = ride.booking_mode === 'request';
    if (isRequest) {
      const balance = await walletBalance(tx, input.passengerId);
      if (balance < priceCents) throw errors.insufficientFunds(balance);
    }

    const bookingId = randomUUID();
    const deadline = isRequest
      ? requestDeadline(at, boardingTimeOf(ride, boardingIdx))
      : null;
    await tx.query(
      `insert into bookings (id, ride_id, passenger_id, boarding_idx, alighting_idx, seats,
         seat_numbers, segment_km, price_cents, state, created_at, hold_expires_at, request_deadline)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        bookingId,
        ride.id,
        input.passengerId,
        boardingIdx,
        alightingIdx,
        seats,
        assigned,
        segKm,
        priceCents,
        isRequest ? 'requested' : 'held',
        at,
        isRequest ? null : holdDeadline(at),
        deadline,
      ],
    );
    await tx.query('insert into booking_history (booking_id, state, at) values ($1, $2, $3)', [
      bookingId,
      isRequest ? 'requested' : 'held',
      at,
    ]);

    const booking = (await loadBookingForUpdate(tx, bookingId)) as BookingRecord;
    if (isRequest) {
      await ledger.payment(
        tx,
        at,
        bookingId,
        input.passengerId,
        priceCents,
        `Seat requested: ${spanLabel(ride, booking)}`,
      );
    }
    return { ride, booking, deadline, at };
  });

  if (result.deadline) await trackRequestDeadline(result.booking.id, result.deadline);
  else await writeHoldKeys(result.booking, result.at);
  await publishSeatMap(result.ride);
  await publishBooking(result.booking.id);
  if (result.booking.state === 'requested') await publishWallet(input.passengerId);

  return serialiseBooking(db, result.booking, result.ride, input.passengerId, now());
}

interface Loaded {
  booking: BookingRecord;
  ride: RideRecord;
}

async function lockBookingAndRide(tx: Queryable, bookingId: string): Promise<Loaded | null> {
  const booking = await loadBookingForUpdate(tx, bookingId);
  if (!booking) return null;
  const ride = await loadRideForUpdate(tx, booking.ride_id);
  if (!ride) return null;
  return { booking, ride };
}

/** Confirm a hold: the wallet is charged here, exactly once. */
export async function confirmBooking(
  bookingId: string,
  passengerId: string,
): Promise<{ booking: Record<string, unknown>; emailIds: string[] }> {
  const result = await withTransaction(async (tx) => {
    const at = now();
    const loaded = await lockBookingAndRide(tx, bookingId);
    if (!loaded) throw errors.notFound();
    const { booking, ride } = loaded;
    if (booking.passenger_id !== passengerId) throw errors.notFound();
    if (booking.state !== 'held') throw errors.invalidTransition();
    if (!booking.hold_expires_at || booking.hold_expires_at.getTime() <= at.getTime()) {
      await recordState(tx, booking.id, 'expired', at, {
        holdExpiresAt: null,
        endedAt: at,
      });
      throw errors.holdExpired();
    }
    const balance = await walletBalance(tx, passengerId);
    if (balance < booking.price_cents) throw errors.insufficientFunds(balance);

    const label = `Seat booked: ${spanLabel(ride, booking)}`;
    await recordState(tx, booking.id, 'confirmed', at, { holdExpiresAt: null });
    await ledger.payment(tx, at, booking.id, passengerId, booking.price_cents, label);
    const passenger = await loadMember(tx, passengerId);
    const copy = mailCopy.bookingConfirmed(
      ride.stops[booking.boarding_idx]?.city ?? '',
      ride.stops[booking.alighting_idx]?.city ?? '',
      dateLabel(isoZoned(boardingTimeOf(ride, booking.boarding_idx))),
      money(booking.price_cents),
    );
    const emailId = await queueEmail(tx, {
      kind: 'booking_confirmed',
      to: passenger?.email ?? '',
      subject: copy.subject,
      body: copy.body,
      bookingId: booking.id,
      memberId: passengerId,
    });
    return { booking, ride, emailIds: [emailId], at };
  });

  await dropHoldKeys(result.booking);
  await publishSeatMap(result.ride);
  await publishBooking(result.booking.id);
  await publishWallet(passengerId);
  const refreshed = (await loadBooking(db, bookingId)) as BookingRecord;
  return {
    booking: await serialiseBooking(db, refreshed, result.ride, passengerId, now()),
    emailIds: result.emailIds,
  };
}

/** Release a hold. A hold charges nothing, so an expired hold writes no money movement. */
export async function releaseBooking(
  bookingId: string,
  passengerId: string,
): Promise<Record<string, unknown>> {
  const result = await withTransaction(async (tx) => {
    const at = now();
    const loaded = await lockBookingAndRide(tx, bookingId);
    if (!loaded) throw errors.notFound();
    const { booking, ride } = loaded;
    if (booking.passenger_id !== passengerId) throw errors.notFound();
    if (booking.state !== 'held') throw errors.invalidTransition();
    await recordState(tx, booking.id, 'expired', at, { holdExpiresAt: null, endedAt: at });
    return { booking, ride };
  });
  await dropHoldKeys(result.booking);
  await publishSeatMap(result.ride);
  await publishBooking(result.booking.id);
  const refreshed = (await loadBooking(db, bookingId)) as BookingRecord;
  return serialiseBooking(db, refreshed, result.ride, passengerId, now());
}

type ReleaseReason = 'declined' | 'expired' | 'withdrawn';

const releaseLabel: Record<ReleaseReason, string> = {
  declined: 'Request declined',
  expired: 'Request expired',
  withdrawn: 'Request withdrawn',
};

/** A declined, expired or withdrawn request refunds 100% at once. */
async function releaseRequest(
  tx: Queryable,
  booking: BookingRecord,
  ride: RideRecord,
  reason: ReleaseReason,
  at: Date,
): Promise<string[]> {
  await recordState(tx, booking.id, reason, at, { requestDeadline: null, endedAt: at });
  await ledger.requestReleased(
    tx,
    at,
    booking.id,
    booking.passenger_id,
    booking.price_cents,
    `${releaseLabel[reason]}: ${spanLabel(ride, booking)}`,
  );
  if (reason === 'withdrawn') return [];
  const passenger = await loadMember(tx, booking.passenger_id);
  const copy =
    reason === 'declined'
      ? mailCopy.requestDeclined(money(booking.price_cents))
      : mailCopy.requestExpired(money(booking.price_cents));
  const emailId = await queueEmail(tx, {
    kind: reason === 'declined' ? 'request_declined' : 'request_expired',
    to: passenger?.email ?? '',
    subject: copy.subject,
    body: copy.body,
    bookingId: booking.id,
    memberId: booking.passenger_id,
  });
  return [emailId];
}

/** Expire one overdue request. Used by the sweep and by any late answer. */
export async function expireRequestWithin(
  tx: Queryable,
  booking: BookingRecord,
  ride: RideRecord,
  at: Date,
): Promise<string[]> {
  return releaseRequest(tx, booking, ride, 'expired', at);
}

export async function withdrawRequest(
  bookingId: string,
  passengerId: string,
): Promise<Record<string, unknown>> {
  const result = await withTransaction(async (tx) => {
    const at = now();
    const loaded = await lockBookingAndRide(tx, bookingId);
    if (!loaded) throw errors.notFound();
    const { booking, ride } = loaded;
    if (booking.passenger_id !== passengerId) throw errors.notFound();
    if (booking.state !== 'requested') throw errors.invalidTransition();
    if (!booking.request_deadline || booking.request_deadline.getTime() <= at.getTime()) {
      const emailIds = await expireRequestWithin(tx, booking, ride, at);
      return { booking, ride, expired: true, emailIds };
    }
    await releaseRequest(tx, booking, ride, 'withdrawn', at);
    return { booking, ride, expired: false, emailIds: [] as string[] };
  });

  await untrackRequestDeadline(bookingId);
  await publishSeatMap(result.ride);
  await publishBooking(bookingId);
  await publishWallet(passengerId);
  if (result.expired) throw errors.requestExpired();
  const refreshed = (await loadBooking(db, bookingId)) as BookingRecord;
  return serialiseBooking(db, refreshed, result.ride, passengerId, now());
}

/** The driver's decision on a pending request. */
export async function decideRequest(
  bookingId: string,
  driverId: string,
  decision: 'accept' | 'decline',
): Promise<{ booking: Record<string, unknown>; emailIds: string[] }> {
  const result = await withTransaction(async (tx) => {
    const at = now();
    const loaded = await lockBookingAndRide(tx, bookingId);
    if (!loaded) throw errors.notFound();
    const { booking, ride } = loaded;
    if (ride.driver_id !== driverId) throw errors.notFound();
    if (booking.state === 'expired') throw errors.requestExpired();
    if (booking.state !== 'requested') throw errors.alreadyDecided();
    if (!booking.request_deadline || booking.request_deadline.getTime() <= at.getTime()) {
      const emailIds = await expireRequestWithin(tx, booking, ride, at);
      return { booking, ride, expired: true, emailIds };
    }
    if (decision === 'decline') {
      const emailIds = await releaseRequest(tx, booking, ride, 'declined', at);
      return { booking, ride, expired: false, emailIds };
    }
    await recordState(tx, booking.id, 'accepted', at);
    await recordState(tx, booking.id, 'confirmed', at, { requestDeadline: null });
    const passenger = await loadMember(tx, booking.passenger_id);
    const driver = await loadMember(tx, driverId);
    const copy = mailCopy.requestAccepted(
      driver?.display_name ?? '',
      ride.stops[booking.boarding_idx]?.city ?? '',
      ride.stops[booking.alighting_idx]?.city ?? '',
      dateLabel(isoZoned(boardingTimeOf(ride, booking.boarding_idx))),
    );
    const emailId = await queueEmail(tx, {
      kind: 'request_accepted',
      to: passenger?.email ?? '',
      subject: copy.subject,
      body: copy.body,
      bookingId: booking.id,
      memberId: booking.passenger_id,
    });
    return { booking, ride, expired: false, emailIds: [emailId] };
  });

  await untrackRequestDeadline(bookingId);
  await publishSeatMap(result.ride);
  await publishBooking(bookingId);
  await publishWallet(result.booking.passenger_id);
  if (result.expired) throw errors.requestExpired();
  const refreshed = (await loadBooking(db, bookingId)) as BookingRecord;
  return {
    booking: await serialiseBooking(db, refreshed, result.ride, driverId, now()),
    emailIds: result.emailIds,
  };
}

/** A passenger cancels a confirmed seat under the tier the quote showed. */
export async function cancelBooking(
  bookingId: string,
  passengerId: string,
): Promise<{ booking: Record<string, unknown>; refund_cents: number; kept_cents: number }> {
  const result = await withTransaction(async (tx) => {
    const at = now();
    const loaded = await lockBookingAndRide(tx, bookingId);
    if (!loaded) throw errors.notFound();
    const { booking, ride } = loaded;
    if (booking.passenger_id !== passengerId) throw errors.notFound();
    if (booking.state !== 'confirmed') throw errors.invalidTransition();
    const boardingTime = boardingTimeOf(ride, booking.boarding_idx);
    if (at.getTime() >= boardingTime.getTime()) throw errors.invalidTransition();

    const quote = cancelQuote(booking.price_cents, boardingTime, at, ride.free_cancel_until);
    await recordState(tx, booking.id, 'cancelled_by_passenger', at, { endedAt: at });
    await ledger.passengerCancellation(
      tx,
      at,
      booking.id,
      passengerId,
      ride.driver_id,
      booking.price_cents,
      quote.refund_cents,
      quote.kept_cents,
      `Refund ${quote.percent}%: ${spanLabel(ride, booking)}`,
    );
    return { booking, ride, quote };
  });

  await publishSeatMap(result.ride);
  await publishBooking(bookingId);
  await publishWallet(passengerId);
  const refreshed = (await loadBooking(db, bookingId)) as BookingRecord;
  return {
    booking: await serialiseBooking(db, refreshed, result.ride, passengerId, now()),
    refund_cents: result.quote.refund_cents,
    kept_cents: result.quote.kept_cents,
  };
}
