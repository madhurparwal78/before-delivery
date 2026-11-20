import type { Booking, BookingMode, BookingState, IdState, Member, Ride, RideState, Role, BookingWithChange } from "../../shared/api";
import type { SeatRow } from "../../shared/seats";
import { type City } from "../../shared/towns";
import { isoBrussels } from "../../shared/time";
import { now } from "../clock";
import type { Db } from "../db";
import { SEAT_HOLDING_STATES } from "../domain/bookingStates";
import { holdEnd, requestDeadline } from "../domain/deadlines";
import { cancelQuote } from "../domain/refunds";
import { segmentKm, shapeRoute, type RouteShape } from "../domain/route";
import { walletBalance } from "./ledger";

export interface MemberRow {
  id: string;
  email: string;
  display_name: string;
  roles: Role[];
  id_state: IdState;
  id_reason: string | null;
  photo_file_id: string | null;
  created_at: Date;
}

interface RideRow {
  id: string;
  driver_id: string;
  vehicle_id: string;
  booking_mode: BookingMode;
  seats: number;
  price_cents: number;
  state: RideState;
  version: number;
  departure: Date;
  created_at: Date;
}

export interface RideRecord {
  row: RideRow;
  route: RouteShape;
}

export interface BookingRow {
  id: string;
  ride_id: string;
  passenger_id: string;
  boarding_index: number;
  alighting_index: number;
  seats: number;
  seat_numbers: number[];
  price_cents: number;
  state: BookingState;
  created_at: Date;
  free_cancel_until: Date | null;
  change_from: Date | null;
  change_to: Date | null;
  rating_closed: boolean;
}

export const serverNow = (): string => isoBrussels(now());

export async function getMemberRow(db: Db, id: string): Promise<MemberRow | undefined> {
  const { rows } = await db.query<MemberRow>("SELECT * FROM members WHERE id = $1", [id]);
  return rows[0];
}

/** Mean of the revealed ratings a member received, rounded half up to one decimal. */
async function ratingOf(db: Db, memberId: string): Promise<{ average: number | null; count: number }> {
  const { rows } = await db.query<{ total: number; count: number }>(
    `SELECT COALESCE(SUM(r.stars), 0)::bigint AS total, COUNT(r.id)::bigint AS count
       FROM ratings r JOIN bookings b ON b.id = r.booking_id JOIN rides d ON d.id = b.ride_id
      WHERE b.state = 'rated'
        AND ((r.by_member_id = b.passenger_id AND d.driver_id = $1) OR (r.by_member_id = d.driver_id AND b.passenger_id = $1))`,
    [memberId],
  );
  const total = rows[0]?.total ?? 0;
  const count = rows[0]?.count ?? 0;
  return { average: count === 0 ? null : Math.floor((total * 20 + count) / (2 * count)) / 10, count };
}

export async function memberView(db: Db, row: MemberRow, self = false): Promise<Member> {
  const view: Member = {
    id: row.id,
    display_name: row.display_name,
    roles: row.roles,
    id_state: row.id_state,
    photo_url: row.photo_file_id ? `/api/files/${row.photo_file_id}` : null,
    rating: await ratingOf(db, row.id),
  };
  if (self) {
    view.email = row.email;
    view.wallet_cents = await walletBalance(db, row.id);
  }
  return view;
}

export async function publicMember(db: Db, id: string): Promise<Member> {
  const row = await getMemberRow(db, id);
  if (!row) throw new Error("member row missing");
  return memberView(db, row);
}

export async function loadRide(db: Db, id: string, lock = false): Promise<RideRecord | undefined> {
  const { rows } = await db.query<RideRow>(`SELECT * FROM rides WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  const row = rows[0];
  if (!row) return undefined;
  const stops = await db.query<{ city: City }>("SELECT city FROM ride_stops WHERE ride_id = $1 ORDER BY position", [id]);
  return { row, route: shapeRoute(stops.rows.map((s) => s.city), row.departure) };
}

export async function loadBooking(db: Db, id: string, lock = false): Promise<BookingRow | undefined> {
  const { rows } = await db.query<BookingRow>(`SELECT * FROM bookings WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0];
}

/** Does this booking take its seats at `at`? A held booking does only while its hold lasts. */
export function takesSeats(booking: BookingRow, at: Date): boolean {
  if (!SEAT_HOLDING_STATES.includes(booking.state)) return false;
  return booking.state !== "held" || holdEnd(booking.created_at).getTime() > at.getTime();
}

export async function seatMapOf(db: Db, ride: RideRecord, at: Date = now()): Promise<SeatRow[]> {
  const { rows } = await db.query<BookingRow>("SELECT * FROM bookings WHERE ride_id = $1 AND state = ANY($2)", [ride.row.id, SEAT_HOLDING_STATES]);
  const legCount = ride.route.cities.length - 1;
  const map: SeatRow[] = Array.from({ length: ride.row.seats }, (_, index) => ({ seat: index + 1, legs: Array<"free" | "taken">(legCount).fill("free") }));
  for (const booking of rows) {
    if (!takesSeats(booking, at)) continue;
    for (const seat of booking.seat_numbers) {
      const row = map[seat - 1];
      if (!row) continue;
      for (let leg = booking.boarding_index; leg < booking.alighting_index; leg += 1) row.legs[leg] = "taken";
    }
  }
  return map;
}

export async function rideView(db: Db, ride: RideRecord): Promise<Ride> {
  const vehicle = await db.query<{ id: string; make_model: string; colour: string; seats: number }>(
    "SELECT id, make_model, colour, seats FROM vehicles WHERE id = $1",
    [ride.row.vehicle_id],
  );
  const at = now();
  return {
    id: ride.row.id,
    state: ride.row.state,
    version: ride.row.version,
    driver: await publicMember(db, ride.row.driver_id),
    vehicle: vehicle.rows[0] as Ride["vehicle"],
    booking_mode: ride.row.booking_mode,
    seats: ride.row.seats,
    price_cents: ride.row.price_cents,
    route_km: ride.route.routeKm,
    stops: ride.route.cities.map((city, index) => ({ city, km: ride.route.cumulativeKm[index] as number, time: isoBrussels(ride.route.times[index] as Date) })),
    legs: ride.route.legKms.map((km, index) => ({ index, from: ride.route.cities[index] as string, to: ride.route.cities[index + 1] as string, km })),
    seat_map: await seatMapOf(db, ride, at),
    server_now: isoBrussels(at),
  };
}

export function boardingTimeOf(ride: RideRecord, booking: BookingRow): Date {
  return ride.route.times[booking.boarding_index] as Date;
}

export function deadlineOf(ride: RideRecord, booking: BookingRow): Date {
  return requestDeadline(booking.created_at, boardingTimeOf(ride, booking));
}

/** The booking's span as a label fragment: `Brisanne to Tollemarch, Fri 13 Nov` is built from this. */
export function spanCities(ride: RideRecord, booking: BookingRow): { from: string; to: string } {
  return { from: ride.route.cities[booking.boarding_index] as string, to: ride.route.cities[booking.alighting_index] as string };
}

export async function bookingView(db: Db, booking: BookingRow, ride: RideRecord, viewerId: string | null): Promise<BookingWithChange> {
  const at = now();
  const history = await db.query<{ state: BookingState; at: Date }>("SELECT state, at FROM booking_history WHERE booking_id = $1 ORDER BY id", [booking.id]);
  const boarding = boardingTimeOf(ride, booking);
  const span = spanCities(ride, booking);
  const asked = history.rows.some((h) => h.state === "requested");
  const showDeadline = asked && (booking.state === "requested" || booking.state === "expired");
  const deadline = showDeadline ? deadlineOf(ride, booking) : null;
  const quotable = viewerId === booking.passenger_id && booking.state === "confirmed";
  const view: Booking = {
    id: booking.id,
    ride_id: booking.ride_id,
    passenger: await publicMember(db, booking.passenger_id),
    driver: await publicMember(db, ride.row.driver_id),
    boarding: span.from,
    alighting: span.to,
    boarding_time: isoBrussels(boarding),
    seats: booking.seats,
    seat_numbers: booking.seat_numbers,
    segment_km: segmentKm(ride.route, booking.boarding_index, booking.alighting_index),
    price_cents: booking.price_cents,
    state: booking.state,
    history: history.rows.map((h) => ({ state: h.state, at: isoBrussels(h.at) })),
    hold_expires_at: booking.state === "held" ? isoBrussels(holdEnd(booking.created_at)) : null,
    expires_at: deadline ? isoBrussels(deadline) : null,
    expires_in_seconds: deadline ? Math.max(0, Math.ceil((deadline.getTime() - at.getTime()) / 1000)) : null,
    free_cancel_until: booking.free_cancel_until ? isoBrussels(booking.free_cancel_until) : null,
    cancel_quote: quotable ? cancelQuote({ paidCents: booking.price_cents, boardingTime: boarding, now: at, freeCancelUntil: booking.free_cancel_until }) : null,
    server_now: isoBrussels(at),
  };
  return { ...view, ride_change: booking.change_from && booking.change_to ? { from_time: isoBrussels(booking.change_from), to_time: isoBrussels(booking.change_to) } : null };
}

