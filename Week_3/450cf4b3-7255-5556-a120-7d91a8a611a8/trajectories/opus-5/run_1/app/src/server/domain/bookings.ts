import { queryOne, type Db } from '../db';
import { addDays } from '../../shared/format';
import { instantOfKitchenLocal, kitchenDate, kitchenMinutesOfDay } from '../kitchen-time';
import { bookingMinutes } from './occupancy';
import type { BookingStatus, CancelReason, DoorAction } from '../../shared/types';
import type { Clearance } from './tenants';

export const CHECK_IN_OPENS_MINUTES_BEFORE = 30;

export interface BookingRow {
  id: string;
  tenant_id: string;
  station_id: string;
  shelf_id: string | null;
  start_at: Date;
  end_at: Date;
  buffer_end_at: Date;
  status: BookingStatus;
  hold_expires_at: Date | null;
  pack_id: string | null;
  debited_minutes: number | null;
  refunded_minutes: number | null;
  cancel_reason: CancelReason | null;
  move_count: number;
  cleanup_note: string | null;
  created_at: Date;
}

export const BOOKING_COLUMNS = `id, tenant_id, station_id, shelf_id, start_at, end_at, buffer_end_at, status,
  hold_expires_at, pack_id, debited_minutes, refunded_minutes, cancel_reason, move_count, cleanup_note, created_at`;

export interface BookingStanding {
  status: BookingStatus;
  cancelReason: CancelReason | null;
}

/** A hold that is no longer live reads as cancelled with hold_expired everywhere. */
export function bookingStanding(booking: BookingRow, now: Date): BookingStanding {
  if (booking.status === 'held' && booking.hold_expires_at !== null && booking.hold_expires_at <= now) {
    return { status: 'cancelled', cancelReason: 'hold_expired' };
  }
  return { status: booking.status, cancelReason: booking.cancel_reason };
}

export function minutesOf(booking: BookingRow): number {
  return bookingMinutes(booking.start_at, booking.end_at, booking.shelf_id === null ? 1 : 2);
}

/** The same kitchen-local wall-clock time on the calendar day before the start. */
export function cutoffOf(start: Date): Date {
  return instantOfKitchenLocal(addDays(kitchenDate(start), -1), kitchenMinutesOfDay(start));
}

export function cancelCreditMinutesOf(booking: BookingRow, now: Date): number | null {
  const standing = bookingStanding(booking, now);
  if (standing.status !== 'confirmed') return null;
  if (now.getTime() > cutoffOf(booking.start_at).getTime()) return 0;
  return booking.debited_minutes ?? 0;
}

/** True exactly when a move would pass the transition, cutoff and move-limit checks. */
export function movableOf(booking: BookingRow, now: Date): boolean {
  const standing = bookingStanding(booking, now);
  if (standing.status !== 'confirmed') return false;
  if (now.getTime() > cutoffOf(booking.start_at).getTime()) return false;
  return booking.move_count < 1;
}

export function checkInOpensAtOf(start: Date): Date {
  return new Date(start.getTime() - CHECK_IN_OPENS_MINUTES_BEFORE * 60000);
}

/** The door actions that would succeed now, by the same rules the door routes apply. */
export function doorActionsOf(
  booking: BookingRow,
  now: Date,
  clearance: Clearance,
): DoorAction[] {
  const standing = bookingStanding(booking, now);
  const actions: DoorAction[] = [];
  if (standing.status === 'confirmed') {
    const opensAt = checkInOpensAtOf(booking.start_at).getTime();
    const closesAt = booking.end_at.getTime();
    if (now.getTime() >= opensAt && now.getTime() < closesAt && clearance.cleared) {
      actions.push('check_in');
    }
  }
  if (standing.status === 'checked_in') actions.push('check_out');
  if (standing.status === 'confirmed' && now.getTime() >= booking.start_at.getTime()) {
    actions.push('no_show');
  }
  return actions;
}

export async function bookingById(client: Db, bookingId: string): Promise<BookingRow | null> {
  return queryOne<BookingRow>(client, `select ${BOOKING_COLUMNS} from bookings where id = $1`, [bookingId]);
}

export async function lockBooking(client: Db, bookingId: string): Promise<BookingRow | null> {
  return queryOne<BookingRow>(
    client,
    `select ${BOOKING_COLUMNS} from bookings where id = $1 for update`,
    [bookingId],
  );
}
