import { now } from './clock.js';
import { db, type Queryable } from './db.js';
import type { City } from '../shared/cities.js';
import {
  cancelQuote,
  expiresInSeconds,
  holdsSeats,
  type BookingState,
} from './domain/booking-rules.js';
import { buildSeatMap, type SeatClaim, type SeatMapEntry } from '../shared/seats.js';
import { routeLegs, stopTime } from './domain/route.js';
import { isoZoned } from './domain/time.js';
import { walletBalance } from './domain/ledger.js';

export type RideState = 'published' | 'changed' | 'departed' | 'arrived' | 'cancelled';
export type BookingMode = 'instant' | 'request';

export interface RideRecord {
  id: string;
  driver_id: string;
  vehicle_id: string;
  booking_mode: BookingMode;
  seats: number;
  price_cents: number;
  route_km: number;
  departure: Date;
  previous_departure: Date | null;
  free_cancel_until: Date | null;
  state: RideState;
  version: number;
  created_at: Date;
  stops: Array<{ city: City; km: number }>;
}

export interface BookingRecord {
  id: string;
  ride_id: string;
  passenger_id: string;
  boarding_idx: number;
  alighting_idx: number;
  seats: number;
  seat_numbers: number[];
  segment_km: number;
  price_cents: number;
  state: BookingState;
  created_at: Date;
  hold_expires_at: Date | null;
  request_deadline: Date | null;
  ended_at: Date | null;
  rating_closes_at: Date | null;
  revealed_at: Date | null;
}

export interface MemberRecord {
  id: string;
  display_name: string;
  email: string;
  roles: string[];
  id_state: string;
  photo_file_id: string | null;
}

const RIDE_COLUMNS = `id, driver_id, vehicle_id, booking_mode, seats, price_cents, route_km,
  departure, previous_departure, free_cancel_until, state, version, created_at`;

export async function loadRide(tx: Queryable, id: string): Promise<RideRecord | null> {
  if (!isUuid(id)) return null;
  const { rows } = await tx.query<RideRecord>(`select ${RIDE_COLUMNS} from rides where id = $1`, [
    id,
  ]);
  const ride = rows[0];
  if (!ride) return null;
  ride.stops = await loadStops(tx, id);
  return ride;
}

/** Load the ride and take its row lock, so seat races and expiries are decided in order. */
export async function loadRideForUpdate(tx: Queryable, id: string): Promise<RideRecord | null> {
  if (!isUuid(id)) return null;
  const { rows } = await tx.query<RideRecord>(
    `select ${RIDE_COLUMNS} from rides where id = $1 for update`,
    [id],
  );
  const ride = rows[0];
  if (!ride) return null;
  ride.stops = await loadStops(tx, id);
  return ride;
}

async function loadStops(
  tx: Queryable,
  rideId: string,
): Promise<Array<{ city: City; km: number }>> {
  const { rows } = await tx.query<{ city: City; km: number }>(
    'select city, km from ride_stops where ride_id = $1 order by idx',
    [rideId],
  );
  return rows;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function rideCities(ride: RideRecord): City[] {
  return ride.stops.map((stop) => stop.city);
}

export function rideStopTimes(ride: RideRecord): Date[] {
  return ride.stops.map((stop) => stopTime(ride.departure, stop.km));
}

export function arrivalTime(ride: RideRecord): Date {
  const times = rideStopTimes(ride);
  return times[times.length - 1] as Date;
}

export function boardingTimeOf(ride: RideRecord, boardingIdx: number): Date {
  return rideStopTimes(ride)[boardingIdx] as Date;
}

export function legCountOf(ride: RideRecord): number {
  return ride.stops.length - 1;
}

export function cityIndex(ride: RideRecord, city: string): number {
  return ride.stops.findIndex((stop) => stop.city === city);
}

const BOOKING_COLUMNS = `id, ride_id, passenger_id, boarding_idx, alighting_idx, seats,
  seat_numbers, segment_km, price_cents, state, created_at, hold_expires_at, request_deadline,
  ended_at, rating_closes_at, revealed_at`;

export async function loadBooking(tx: Queryable, id: string): Promise<BookingRecord | null> {
  if (!isUuid(id)) return null;
  const { rows } = await tx.query<BookingRecord>(
    `select ${BOOKING_COLUMNS} from bookings where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function loadBookingForUpdate(
  tx: Queryable,
  id: string,
): Promise<BookingRecord | null> {
  if (!isUuid(id)) return null;
  const { rows } = await tx.query<BookingRecord>(
    `select ${BOOKING_COLUMNS} from bookings where id = $1 for update`,
    [id],
  );
  return rows[0] ?? null;
}

export async function rideBookings(tx: Queryable, rideId: string): Promise<BookingRecord[]> {
  const { rows } = await tx.query<BookingRecord>(
    `select ${BOOKING_COLUMNS} from bookings where ride_id = $1 order by created_at, id`,
    [rideId],
  );
  return rows;
}

/**
 * The claims that hold seats right now: confirmed bookings, pending requests and live
 * holds. A hold past its deadline and a request past its deadline hold nothing.
 */
export function activeClaims(bookings: readonly BookingRecord[], at: Date): SeatClaim[] {
  return bookings
    .filter((booking) => {
      if (!holdsSeats(booking.state)) return false;
      if (booking.state === 'held') {
        return !!booking.hold_expires_at && booking.hold_expires_at.getTime() > at.getTime();
      }
      if (booking.state === 'requested') {
        return !!booking.request_deadline && booking.request_deadline.getTime() > at.getTime();
      }
      return true;
    })
    .map((booking) => ({
      seatNumbers: booking.seat_numbers,
      boardingIdx: booking.boarding_idx,
      alightingIdx: booking.alighting_idx,
    }));
}

export async function seatMapOf(
  tx: Queryable,
  ride: RideRecord,
  at: Date,
): Promise<SeatMapEntry[]> {
  const bookings = await rideBookings(tx, ride.id);
  return buildSeatMap(ride.seats, legCountOf(ride), activeClaims(bookings, at));
}

export async function loadMember(tx: Queryable, id: string): Promise<MemberRecord | null> {
  if (!isUuid(id)) return null;
  const { rows } = await tx.query<MemberRecord>(
    'select id, display_name, email, roles, id_state, photo_file_id from members where id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function loadMemberByEmail(
  tx: Queryable,
  email: string,
): Promise<MemberRecord | null> {
  const { rows } = await tx.query<MemberRecord>(
    'select id, display_name, email, roles, id_state, photo_file_id from members where email = $1',
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}

export interface BookingAmounts {
  paid_cents: number;
  refunded_cents: number;
  earned_cents: number;
}

/** Every money figure on a booking comes from the ledger, to the cent. */
export async function bookingAmounts(
  tx: Queryable,
  bookingId: string,
): Promise<BookingAmounts> {
  const { rows } = await tx.query<{ paid: number; refunded: number; earned: number }>(
    `select
       coalesce(sum(case when l.account = 'held:' || $1::text and l.amount_cents > 0 then l.amount_cents else 0 end), 0)::int as paid,
       coalesce(sum(case when l.wallet_member_id is not null and l.amount_cents > 0 then l.amount_cents else 0 end), 0)::int as refunded,
       coalesce(sum(case when l.earnings_member_id is not null then l.amount_cents else 0 end), 0)::int as earned
     from ledger_lines l join ledger_entries e on e.id = l.entry_id
     where e.booking_id = $1::uuid`,
    [bookingId],
  );
  const row = rows[0];
  return {
    paid_cents: Number(row?.paid ?? 0),
    refunded_cents: Number(row?.refunded ?? 0),
    earned_cents: Number(row?.earned ?? 0),
  };
}

export interface RatingAggregate {
  average: number | null;
  count: number;
}

/** A member's average counts only revealed ratings, rounded half up to one decimal. */
export async function ratingAggregate(
  tx: Queryable,
  memberId: string,
): Promise<RatingAggregate> {
  const { rows } = await tx.query<{ total: number | null; count: number }>(
    `select coalesce(sum(r.stars), 0)::int as total, count(*)::int as count
       from ratings r join bookings b on b.id = r.booking_id
      where r.subject_id = $1 and b.state = 'rated'`,
    [memberId],
  );
  const row = rows[0];
  const count = row ? Number(row.count) : 0;
  if (count === 0) return { average: null, count: 0 };
  const total = Number(row?.total ?? 0);
  return { average: Math.floor((total / count) * 10 + 0.5) / 10, count };
}

export interface MemberShape {
  id: string;
  display_name: string;
  roles: string[];
  id_state: string;
  photo_url: string | null;
  rating: RatingAggregate;
  email?: string;
  wallet_cents?: number;
}

export async function serialiseMember(
  tx: Queryable,
  member: MemberRecord,
  options: { self?: boolean } = {},
): Promise<MemberShape> {
  const shape: MemberShape = {
    id: member.id,
    display_name: member.display_name,
    roles: member.roles,
    id_state: member.id_state,
    photo_url: member.photo_file_id ? `/api/files/${member.photo_file_id}` : null,
    rating: await ratingAggregate(tx, member.id),
  };
  if (options.self) {
    shape.email = member.email;
    shape.wallet_cents = await walletBalance(tx, member.id);
  }
  return shape;
}

export async function serialiseRide(
  tx: Queryable,
  ride: RideRecord,
  at: Date = now(),
): Promise<Record<string, unknown>> {
  const driver = await loadMember(tx, ride.driver_id);
  const { rows: vehicleRows } = await tx.query<{
    id: string;
    make_model: string;
    colour: string;
    seats: number;
  }>('select id, make_model, colour, seats from vehicles where id = $1', [ride.vehicle_id]);
  const cities = rideCities(ride);
  const times = rideStopTimes(ride);
  return {
    id: ride.id,
    state: ride.state,
    version: ride.version,
    driver: driver ? await serialiseMember(tx, driver) : null,
    vehicle: vehicleRows[0] ?? null,
    booking_mode: ride.booking_mode,
    seats: ride.seats,
    price_cents: ride.price_cents,
    route_km: ride.route_km,
    departure: isoZoned(ride.departure),
    previous_departure: ride.previous_departure ? isoZoned(ride.previous_departure) : null,
    free_cancel_until: ride.free_cancel_until ? isoZoned(ride.free_cancel_until) : null,
    arrival: isoZoned(arrivalTime(ride)),
    stops: ride.stops.map((stop, index) => ({
      city: stop.city,
      km: stop.km,
      time: isoZoned(times[index] as Date),
    })),
    legs: routeLegs(cities).map((leg) => ({
      index: leg.index,
      from: leg.from,
      to: leg.to,
      km: leg.km,
    })),
    seat_map: await seatMapOf(tx, ride, at),
    server_now: isoZoned(at),
  };
}

export async function bookingHistory(
  tx: Queryable,
  bookingId: string,
): Promise<Array<{ state: string; at: string }>> {
  const { rows } = await tx.query<{ state: string; at: Date }>(
    'select state, at from booking_history where booking_id = $1 order by id',
    [bookingId],
  );
  return rows.map((row) => ({ state: row.state, at: isoZoned(row.at) }));
}

export async function serialiseBooking(
  tx: Queryable,
  booking: BookingRecord,
  ride: RideRecord,
  viewerId: string | null,
  at: Date = now(),
): Promise<Record<string, unknown>> {
  const passenger = await loadMember(tx, booking.passenger_id);
  const driver = await loadMember(tx, ride.driver_id);
  const boardingTime = boardingTimeOf(ride, booking.boarding_idx);
  const isPassenger = viewerId === booking.passenger_id;
  const quoteApplies =
    isPassenger && booking.state === 'confirmed' && at.getTime() < boardingTime.getTime();
  const amounts = await bookingAmounts(tx, booking.id);
  return {
    ...amounts,
    id: booking.id,
    ride_id: booking.ride_id,
    passenger: passenger ? await serialiseMember(tx, passenger) : null,
    driver: driver ? await serialiseMember(tx, driver) : null,
    boarding: ride.stops[booking.boarding_idx]?.city ?? null,
    alighting: ride.stops[booking.alighting_idx]?.city ?? null,
    boarding_time: isoZoned(boardingTime),
    seats: booking.seats,
    seat_numbers: booking.seat_numbers,
    segment_km: booking.segment_km,
    price_cents: booking.price_cents,
    state: booking.state,
    booking_mode: ride.booking_mode,
    ride_state: ride.state,
    ride_version: ride.version,
    ride_departure: isoZoned(ride.departure),
    ride_previous_departure: ride.previous_departure
      ? isoZoned(ride.previous_departure)
      : null,
    history: await bookingHistory(tx, booking.id),
    hold_expires_at: booking.hold_expires_at ? isoZoned(booking.hold_expires_at) : null,
    expires_at: booking.request_deadline ? isoZoned(booking.request_deadline) : null,
    expires_in_seconds:
      booking.state === 'requested' && booking.request_deadline
        ? expiresInSeconds(booking.request_deadline, at)
        : null,
    free_cancel_until: ride.free_cancel_until ? isoZoned(ride.free_cancel_until) : null,
    cancel_quote: quoteApplies
      ? cancelQuote(booking.price_cents, boardingTime, at, ride.free_cancel_until)
      : null,
    server_now: isoZoned(at),
  };
}

export async function serialiseBookingById(
  bookingId: string,
  viewerId: string | null,
): Promise<Record<string, unknown> | null> {
  const booking = await loadBooking(db, bookingId);
  if (!booking) return null;
  const ride = await loadRide(db, booking.ride_id);
  if (!ride) return null;
  return serialiseBooking(db, booking, ride, viewerId);
}
