import { Deps, BookingRow, inWriteTx, getBookingRow, getCurrentDocuments } from '../store.js';
import { ApiError } from '../api/errors.js';
import { ruleCopy } from '../api/copy.js';
import { clearanceFor } from './occupancy.js';
import { appendDoorLog, doorActions } from './door.js';
import { lockBooking } from './actions.js';

const CLEARANCE_REASON_TEXT: Record<string, string> = {
  not_approved: 'not approved yet',
  insurance_lapsed: 'certificate of insurance lapsed',
  food_handler_lapsed: 'food-handler card lapsed',
};

export function clearanceReasonText(reason: string | null): string | null {
  if (reason === null) return null;
  return CLEARANCE_REASON_TEXT[reason] ?? reason;
}

export async function checkIn(deps: Deps, bookingId: string, staffName: string): Promise<BookingRow> {
  return inWriteTx(deps, async (tx, now) => {
    await lockBooking(tx, bookingId);
    const b = await getBookingRow(tx, bookingId);
    if (!b) throw new ApiError(404, 'not_found', "That record isn't available.");
    if (b.status !== 'confirmed') {
      throw new ApiError(409, 'invalid_transition', ruleCopy.invalidTransitionDoor('checked in'));
    }
    const opensAt = b.start - 30 * 60_000;
    if (now < opensAt || now >= b.end) {
      throw new ApiError(409, 'outside_check_in_window', ruleCopy.outsideCheckIn);
    }
    const todayKey = deps.clock.dateKey(now);
    const docs = await getCurrentDocuments(tx, b.tenant_id);
    const tenantR = await tx.query<{ status: string }>(`SELECT status FROM tenants WHERE id=$1`, [b.tenant_id]);
    const clearance = clearanceFor(tenantR.rows[0].status, docs.insurance?.expires_on ?? null, docs.foodHandler?.expires_on ?? null, todayKey);
    if (!clearance.cleared) {
      throw new ApiError(409, 'not_cleared', ruleCopy.notCleared(clearanceReasonText(clearance.reason)!));
    }
    await tx.query(`UPDATE bookings SET status='checked_in' WHERE id=$1`, [bookingId]);
    await appendDoorLog(tx, bookingId, 'check_in', now, staffName);
    void doorActions;
    return (await getBookingRow(tx, bookingId))!;
  });
}

export async function checkOut(deps: Deps, bookingId: string, staffName: string, cleanupDone: boolean, note: string): Promise<BookingRow> {
  return inWriteTx(deps, async (tx, now) => {
    await lockBooking(tx, bookingId);
    const b = await getBookingRow(tx, bookingId);
    if (!b) throw new ApiError(404, 'not_found', "That record isn't available.");
    if (b.status !== 'checked_in') {
      throw new ApiError(409, 'invalid_transition', ruleCopy.invalidTransitionDoor('checked out'));
    }
    await tx.query(`UPDATE bookings SET status='completed', cleanup_note=$2 WHERE id=$1`, [bookingId, note]);
    await appendDoorLog(tx, bookingId, 'check_out', now, staffName);
    void cleanupDone;
    return (await getBookingRow(tx, bookingId))!;
  });
}

export async function markNoShow(deps: Deps, bookingId: string, staffName: string): Promise<BookingRow> {
  return inWriteTx(deps, async (tx, now) => {
    await lockBooking(tx, bookingId);
    const b = await getBookingRow(tx, bookingId);
    if (!b) throw new ApiError(404, 'not_found', "That record isn't available.");
    if (b.status !== 'confirmed') {
      throw new ApiError(409, 'invalid_transition', ruleCopy.invalidTransitionDoor('marked no-show'));
    }
    if (now < b.start) {
      throw new ApiError(409, 'too_early', ruleCopy.tooEarly);
    }
    await tx.query(`UPDATE bookings SET status='no_show' WHERE id=$1`, [bookingId]);
    await appendDoorLog(tx, bookingId, 'no_show', now, staffName);
    return (await getBookingRow(tx, bookingId))!;
  });
}
