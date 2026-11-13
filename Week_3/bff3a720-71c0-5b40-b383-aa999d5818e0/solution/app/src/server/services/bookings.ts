import { segmentPriceCents } from "../../shared/money";
import { assignSeats } from "../../shared/seats";
import { shortDate } from "../../shared/time";
import { now } from "../clock";
import { newId, type TxHandle } from "../db";
import { assertMove } from "../domain/bookingStates";
import { holdEnd, requestDeadline } from "../domain/deadlines";
import { cancelQuote } from "../domain/refunds";
import { segmentKm } from "../domain/route";
import { apiErrors } from "../http/errors";
import { clearRequestDeadline, placeHold, releaseHold, setRequestDeadline } from "../valkey";
import type { BookingState } from "../../shared/api";
import { emails } from "./emails";
import { emitBooking, emitSeats, emitWallet } from "./events";
import {
  recordPassengerCancellation, recordPayment, recordRequestRelease, recordCompletion, walletBalance,
} from "./ledger";
import { enqueue } from "./outbox";
import { boardingTimeOf, getMemberRow, loadBooking, seatMapOf, spanCities, type BookingRow, type MemberRow, type RideRecord } from "./views";

export interface SpanRequest {
  boardingIndex: number;
  alightingIndex: number;
  seats: number;
}

function trip(ride: RideRecord, booking: BookingRow): { from: string; to: string; boardingTime: Date } {
  return { ...spanCities(ride, booking), boardingTime: boardingTimeOf(ride, booking) };
}

/** `Brisanne to Tollemarch, Fri 13 Nov` */
export function tripLabel(ride: RideRecord, booking: BookingRow): string {
  const { from, to, boardingTime } = trip(ride, booking);
  return `${from} to ${to}, ${shortDate(boardingTime)}`;
}

export function legsOf(booking: { boarding_index: number; alighting_index: number }): number[] {
  const legs: number[] = [];
  for (let leg = booking.boarding_index; leg < booking.alighting_index; leg += 1) legs.push(leg);
  return legs;
}

/** Every booking state change goes through here: validate the move, write the state and its history. */
export async function moveTo(db: TxHandle, booking: BookingRow, to: BookingState, at: Date): Promise<void> {
  assertMove(booking.state, to);
  await db.query("UPDATE bookings SET state = $2 WHERE id = $1", [booking.id, to]);
  await db.query("INSERT INTO booking_history (booking_id, state, at) VALUES ($1, $2, $3)", [booking.id, to, at]);
  booking.state = to;
}

function announce(db: TxHandle, booking: BookingRow, wallet = false): void {
  db.afterCommit(async () => {
    await emitBooking(booking.id);
    await emitSeats(booking.ride_id);
    if (wallet) await emitWallet(booking.passenger_id);
  });
}

/** Lowest-numbered seats free on every leg of the span, or 409 seat_taken. The one seat-claim rule. */
export async function claimSeats(db: TxHandle, ride: RideRecord, span: SpanRequest): Promise<number[]> {
  const map = await seatMapOf(db, ride, now());
  const seats = assignSeats(map, span.boardingIndex, span.alightingIndex, span.seats);
  if (!seats) throw apiErrors.seatTaken();
  return seats;
}

export function spanPriceCents(ride: RideRecord, span: SpanRequest): number {
  const km = segmentKm(ride.route, span.boardingIndex, span.alightingIndex);
  return segmentPriceCents(ride.row.price_cents, km, ride.route.routeKm) * span.seats;
}

export async function assertFunds(db: TxHandle, memberId: string, priceCents: number): Promise<void> {
  await db.query("SELECT id FROM members WHERE id = $1 FOR UPDATE", [memberId]);
  const balance = await walletBalance(db, memberId);
  if (balance < priceCents) throw apiErrors.insufficientFunds(balance);
}

async function insertBooking(db: TxHandle, ride: RideRecord, passengerId: string, span: SpanRequest, seatNumbers: number[], state: "held" | "requested", at: Date): Promise<BookingRow> {
  const id = newId();
  await db.query(
    `INSERT INTO bookings (id, ride_id, passenger_id, boarding_index, alighting_index, seats, seat_numbers, price_cents, state, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, ride.row.id, passengerId, span.boardingIndex, span.alightingIndex, span.seats, seatNumbers, spanPriceCents(ride, span), state, at],
  );
  await db.query("INSERT INTO booking_history (booking_id, state, at) VALUES ($1, $2, $3)", [id, state, at]);
  return (await loadBooking(db, id)) as BookingRow;
}

/** Instant mode places a hold (no charge); request mode charges the wallet and starts the request deadline. */
export async function createBooking(db: TxHandle, ride: RideRecord, passenger: MemberRow, span: SpanRequest): Promise<BookingRow> {
  const at = now();
  const seatNumbers = await claimSeats(db, ride, span);
  const price = spanPriceCents(ride, span);
  await assertFunds(db, passenger.id, price);
  if (ride.row.booking_mode === "instant") {
    const booking = await insertBooking(db, ride, passenger.id, span, seatNumbers, "held", at);
    const remaining = holdEnd(at).getTime() - at.getTime();
    db.afterCommit(() => placeHold(ride.row.id, legsOf(booking), seatNumbers, booking.id, remaining));
    announce(db, booking);
    return booking;
  }
  const booking = await insertBooking(db, ride, passenger.id, span, seatNumbers, "requested", at);
  await recordPayment(db, booking.id, passenger.id, price, `Seat requested: ${tripLabel(ride, booking)}`, at);
  const deadline = requestDeadline(at, boardingTimeOf(ride, booking));
  db.afterCommit(() => setRequestDeadline(booking.id, deadline.getTime()));
  announce(db, booking, true);
  return booking;
}

function dropHold(db: TxHandle, ride: RideRecord, booking: BookingRow): void {
  db.afterCommit(() => releaseHold(ride.row.id, legsOf(booking), booking.seat_numbers));
}

/** A hold released by the passenger, or one that ran out: no money moved. */
export async function expireHold(db: TxHandle, ride: RideRecord, booking: BookingRow): Promise<void> {
  await moveTo(db, booking, "expired", now());
  dropHold(db, ride, booking);
  announce(db, booking);
}

export async function confirmHold(db: TxHandle, ride: RideRecord, booking: BookingRow): Promise<void> {
  const at = now();
  const passenger = (await getMemberRow(db, booking.passenger_id)) as MemberRow;
  await assertFunds(db, passenger.id, booking.price_cents);
  await recordPayment(db, booking.id, passenger.id, booking.price_cents, `Seat booked: ${tripLabel(ride, booking)}`, at);
  await moveTo(db, booking, "confirmed", at);
  await enqueue(db, emails.bookingConfirmed(passenger.email, passenger.display_name, trip(ride, booking), booking.price_cents));
  dropHold(db, ride, booking);
  announce(db, booking, true);
}

async function releaseRequest(db: TxHandle, ride: RideRecord, booking: BookingRow, to: "declined" | "expired" | "withdrawn", label: string): Promise<MemberRow> {
  const at = now();
  await moveTo(db, booking, to, at);
  await recordRequestRelease(db, booking.id, booking.passenger_id, booking.price_cents, `${label}: ${tripLabel(ride, booking)}`, at);
  db.afterCommit(() => clearRequestDeadline(booking.id));
  announce(db, booking, true);
  return (await getMemberRow(db, booking.passenger_id)) as MemberRow;
}

export async function expireRequest(db: TxHandle, ride: RideRecord, booking: BookingRow): Promise<void> {
  const passenger = await releaseRequest(db, ride, booking, "expired", "Request expired");
  await enqueue(db, emails.requestExpired(passenger.email, passenger.display_name, booking.price_cents));
}

export async function declineRequest(db: TxHandle, ride: RideRecord, booking: BookingRow): Promise<void> {
  const passenger = await releaseRequest(db, ride, booking, "declined", "Request declined");
  await enqueue(db, emails.requestDeclined(passenger.email, passenger.display_name, booking.price_cents));
}

export async function withdrawRequest(db: TxHandle, ride: RideRecord, booking: BookingRow): Promise<void> {
  await releaseRequest(db, ride, booking, "withdrawn", "Request withdrawn");
}

export async function acceptRequest(db: TxHandle, ride: RideRecord, booking: BookingRow, driverName: string): Promise<void> {
  const at = now();
  await moveTo(db, booking, "accepted", at);
  await moveTo(db, booking, "confirmed", at);
  const passenger = (await getMemberRow(db, booking.passenger_id)) as MemberRow;
  await enqueue(db, emails.requestAccepted(passenger.email, passenger.display_name, driverName, trip(ride, booking)));
  db.afterCommit(() => clearRequestDeadline(booking.id));
  announce(db, booking);
}

/** A passenger cancellation: the quote decides the split of the paid amount between wallet and driver. */
export async function cancelByPassenger(db: TxHandle, ride: RideRecord, booking: BookingRow): Promise<{ refundCents: number; keptCents: number }> {
  const at = now();
  const quote = cancelQuote({ paidCents: booking.price_cents, boardingTime: boardingTimeOf(ride, booking), now: at, freeCancelUntil: booking.free_cancel_until });
  if (!quote) throw apiErrors.invalidTransition();
  await moveTo(db, booking, "cancelled_by_passenger", at);
  await recordPassengerCancellation(db, booking.id, booking.passenger_id, ride.row.driver_id, booking.price_cents, quote.refund_cents, `Refund ${quote.percent}%: ${tripLabel(ride, booking)}`, at);
  announce(db, booking, true);
  return { refundCents: quote.refund_cents, keptCents: quote.kept_cents };
}

/** Ride arrival: a confirmed booking is completed and the driver keeps everything. */
export async function completeBooking(db: TxHandle, ride: RideRecord, booking: BookingRow): Promise<void> {
  const at = now();
  await moveTo(db, booking, "completed", at);
  await recordCompletion(db, booking.id, ride.row.driver_id, booking.price_cents, at);
  announce(db, booking);
}
