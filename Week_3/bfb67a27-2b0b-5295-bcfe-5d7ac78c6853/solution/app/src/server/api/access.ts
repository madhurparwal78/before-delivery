import type { IncomingMessage } from 'node:http';
import type { Queryable } from '../db.js';
import { notFound, unauthenticated } from '../errors.js';
import { renterKeyHeader, staffRole } from '../auth.js';
import { findBookingRow, type BookingRow } from '../../domain/bookings.js';
import type { Role } from '../../shared/types.js';

interface BookingAccess {
  row: BookingRow;
  role: Role;
}

/**
 * Resolves who is acting on a booking. A staff session reaches every booking; a
 * renter key reaches only its own, and any other key is no access at all.
 */
export async function accessBooking(
  client: Queryable,
  req: IncomingMessage,
  ref: string,
  lock = false,
): Promise<BookingAccess> {
  const staff = await staffRole(req);
  if (staff !== null) {
    const row = await findBookingRow(client, ref, lock);
    if (row === null) throw notFound();
    return { row, role: staff };
  }
  const key = renterKeyHeader(req);
  if (key === null) throw unauthenticated();
  const row = await findBookingRow(client, ref, lock);
  if (row === null || row.renterKey !== key) throw notFound();
  return { row, role: 'renter' };
}
