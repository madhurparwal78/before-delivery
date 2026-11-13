import type { PoolClient } from 'pg';
import type { SessionUser } from '../../shared/api.js';
import { query } from '../db/pool.js';
import type { HeldCredential } from '../domain/qualification.js';
import { apiError } from '../http/errors.js';
import { isOfferedTo } from '../views/booking.js';
import { loadBooking, type BookingRecord } from './bookings.js';

export async function credentialsOf(userId: string): Promise<HeldCredential[]> {
  return query<HeldCredential>(
    'SELECT code, expires_on FROM credentials WHERE user_id = $1 ORDER BY code',
    [userId],
  );
}

export async function canSeeBooking(
  user: SessionUser,
  booking: BookingRecord,
): Promise<boolean> {
  switch (user.role) {
    case 'coordinator':
    case 'billing_manager':
      return true;
    case 'requester':
      return booking.org_id === user.org_id;
    case 'interpreter': {
      if (booking.seats.some((seat) => seat.holder?.id === user.id)) return true;
      return isOfferedTo(booking, await credentialsOf(user.id));
    }
  }
}

export async function requireVisibleBooking(
  user: SessionUser,
  id: string,
  client?: PoolClient,
): Promise<BookingRecord> {
  const booking = await loadBooking(id, client);
  if (!booking) throw apiError('not_found');
  if (!(await canSeeBooking(user, booking))) throw apiError('not_found');
  return booking;
}
