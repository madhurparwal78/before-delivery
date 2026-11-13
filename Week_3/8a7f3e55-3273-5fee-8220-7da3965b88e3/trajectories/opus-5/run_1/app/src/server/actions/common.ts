import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { BookingStatus } from '../../shared/api.js';
import { statusFromSeats } from '../domain/booking-rules.js';
import { loadBooking, seatsHeld, type BookingRecord } from '../store/bookings.js';

export type AuditAction =
  | 'submitted'
  | 'made_team'
  | 'open_call_published'
  | 'seat_filled'
  | 'seat_released'
  | 'checked_in'
  | 'completed'
  | 'cancelled';

export interface AuditInput {
  bookingId: string;
  actorName: string;
  action: AuditAction;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  seat?: number;
  interpreterName?: string;
}

export async function writeAudit(client: PoolClient, entry: AuditInput): Promise<void> {
  await client.query(
    `INSERT INTO audit_entries (booking_id, actor_name, action, from_status, to_status, seat, interpreter_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.bookingId,
      entry.actorName,
      entry.action,
      entry.fromStatus,
      entry.toStatus,
      entry.seat ?? null,
      entry.interpreterName ?? null,
    ],
  );
}

export async function queueEmail(
  client: PoolClient,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  await client.query(
    `INSERT INTO email_queue (id, to_email, subject, body, state) VALUES ($1, $2, $3, $4, 'queued')`,
    [randomUUID(), to, subject, body],
  );
}

export async function nextReference(
  client: PoolClient,
  counter: 'booking_ref' | 'line_ref',
  prefix: string,
): Promise<string> {
  const result = await client.query<{ value: number }>(
    'UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value',
    [counter],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Missing counter ${counter}`);
  return `${prefix}${row.value}`;
}

export async function lockBooking(
  client: PoolClient,
  bookingId: string,
): Promise<BookingRecord | null> {
  const locked = await client.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [
    bookingId,
  ]);
  if (locked.rowCount === 0) return null;
  return loadBooking(bookingId, client);
}

export async function applySeatStatus(
  client: PoolClient,
  booking: BookingRecord,
): Promise<BookingStatus> {
  const fresh = await loadBooking(booking.id, client);
  if (!fresh) throw new Error(`Booking ${booking.id} disappeared`);
  const status = statusFromSeats(
    seatsHeld(fresh),
    fresh.seat_count,
    fresh.open_call_closes_at !== null,
  );
  await client.query('UPDATE bookings SET status = $2 WHERE id = $1', [booking.id, status]);
  return status;
}

export async function isBusy(
  client: Pool | PoolClient,
  interpreterId: string,
  booking: BookingRecord,
): Promise<boolean> {
  const end = new Date(booking.start_at.getTime() + booking.duration_minutes * 60_000);
  const result = await client.query(
    `SELECT 1 FROM seats s JOIN bookings b ON b.id = s.booking_id
     WHERE s.holder_id = $1 AND b.id <> $2
       AND b.status NOT IN ('cancelled', 'cancelled_late')
       AND b.start_at < $4
       AND (b.start_at + (b.duration_minutes * interval '1 minute')) > $3
     LIMIT 1`,
    [interpreterId, booking.id, booking.start_at, end],
  );
  return (result.rowCount ?? 0) > 0;
}
