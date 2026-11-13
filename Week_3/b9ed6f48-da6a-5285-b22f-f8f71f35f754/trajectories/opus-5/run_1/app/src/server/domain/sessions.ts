import { formatLisbonDateTime, toLisbonIso } from '../../shared/lisbon.js';
import type { Currency } from '../../shared/money.js';
import type { GuidedSession, SessionStatus } from '../../shared/types.js';
import { newId, pool, query, queryOne, withTransaction, type Tx } from '../db/index.js';

export const BOOKING_CLOSE_MINUTES = 30;
const MINUTE_MS = 60_000;

export interface SessionRow {
  id: string;
  title: string;
  starts_at: Date;
  duration_minutes: number;
  capacity: number;
  cancelled_at: Date | null;
  cancel_reason: string | null;
}

export function bookingClosesAt(startsAtMs: number): number {
  return startsAtMs - BOOKING_CLOSE_MINUTES * MINUTE_MS;
}

/** The one place a session's status is decided, always by the server clock. */
export function sessionStatus(row: SessionRow, nowMs: number): SessionStatus {
  if (row.cancelled_at) return 'cancelled';
  const startsAtMs = row.starts_at.getTime();
  if (nowMs >= startsAtMs + row.duration_minutes * MINUTE_MS) return 'held';
  if (nowMs >= bookingClosesAt(startsAtMs)) return 'closed';
  return 'on_sale';
}

/** A booking is live unless it has been fully refunded or its session cancelled. */
export async function seatsTaken(sessionId: string, tx?: Tx): Promise<number> {
  const text = `SELECT COALESCE(SUM(seats), 0)::int AS taken FROM bookings
                WHERE session_id = $1 AND state IN ('held', 'booked')`;
  const rows = tx
    ? await tx.query<{ taken: number }>(text, [sessionId])
    : await query<{ taken: number }>(text, [sessionId]);
  return rows[0]?.taken ?? 0;
}

export async function seatsLeft(row: SessionRow, tx?: Tx): Promise<number> {
  if (row.cancelled_at) return row.capacity;
  return row.capacity - (await seatsTaken(row.id, tx));
}

export async function loadSession(id: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>(
    `SELECT id, title, starts_at, duration_minutes, capacity, cancelled_at, cancel_reason
     FROM guided_sessions WHERE id = $1`,
    [id],
  );
}

export async function listSessions(): Promise<SessionRow[]> {
  return query<SessionRow>(
    `SELECT id, title, starts_at, duration_minutes, capacity, cancelled_at, cancel_reason
     FROM guided_sessions ORDER BY starts_at, id`,
  );
}

export async function toSessionView(
  row: SessionRow,
  nowMs: number,
  price: { amountMinor: number; currency: Currency } | null,
): Promise<GuidedSession> {
  const startsAtMs = row.starts_at.getTime();
  return {
    id: row.id,
    title: row.title,
    starts_at: toLisbonIso(startsAtMs),
    starts_at_display: formatLisbonDateTime(startsAtMs),
    duration_minutes: row.duration_minutes,
    capacity: row.capacity,
    seats_left: await seatsLeft(row),
    status: sessionStatus(row, nowMs),
    booking_closes_at: toLisbonIso(bookingClosesAt(startsAtMs)),
    ...(price ? { price_minor: price.amountMinor, currency: price.currency } : {}),
  };
}

export function newTicketCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `T-${code}`;
}

export type Allocation =
  | { kind: 'held'; bookingId: string; ticketCode: string }
  | { kind: 'booking_closed' }
  | { kind: 'sold_out' };

/** Seats are taken atomically, judged against the session state at commit. */
export async function allocateSeats(
  sessionId: string,
  userId: string,
  seats: number,
  nowMs: number,
): Promise<Allocation> {
  return withTransaction(async (tx) => {
    const rows = await tx.query<SessionRow>(
      `SELECT id, title, starts_at, duration_minutes, capacity, cancelled_at, cancel_reason
       FROM guided_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) return { kind: 'booking_closed' };
    if (sessionStatus(row, nowMs) !== 'on_sale') return { kind: 'booking_closed' };
    const left = row.capacity - (await seatsTaken(sessionId, tx));
    if (seats > left) return { kind: 'sold_out' };
    const bookingId = newId('bkg');
    const ticketCode = newTicketCode();
    await tx.query(
      `INSERT INTO bookings (id, session_id, user_id, seats, ticket_code, state)
       VALUES ($1, $2, $3, $4, $5, 'held')`,
      [bookingId, sessionId, userId, seats, ticketCode],
    );
    return { kind: 'held', bookingId, ticketCode };
  });
}

export async function releaseSeats(bookingId: string): Promise<void> {
  await pool.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
}

export async function confirmBooking(bookingId: string): Promise<void> {
  await pool.query(`UPDATE bookings SET state = 'booked' WHERE id = $1`, [bookingId]);
}

export async function cancelBooking(bookingId: string): Promise<void> {
  await pool.query(`UPDATE bookings SET state = 'cancelled' WHERE id = $1`, [bookingId]);
}

export interface LiveBooking {
  id: string;
  session_id: string;
  user_id: string;
  seats: number;
  ticket_code: string;
}

/** Marks a session cancelled, returning the bookings that were live at that moment. */
export async function cancelSessionAtomically(
  sessionId: string,
  reason: string,
  nowMs: number,
): Promise<{ cancelled: boolean; bookings: LiveBooking[] }> {
  return withTransaction(async (tx) => {
    const rows = await tx.query<SessionRow>(
      `SELECT id, title, starts_at, duration_minutes, capacity, cancelled_at, cancel_reason
       FROM guided_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) return { cancelled: false, bookings: [] };
    const status = sessionStatus(row, nowMs);
    if (status !== 'on_sale' && status !== 'closed') return { cancelled: false, bookings: [] };
    const bookings = await tx.query<LiveBooking>(
      `SELECT id, session_id, user_id, seats, ticket_code FROM bookings
       WHERE session_id = $1 AND state = 'booked' ORDER BY created_at, id`,
      [sessionId],
    );
    await tx.query('UPDATE guided_sessions SET cancelled_at = $2, cancel_reason = $3 WHERE id = $1', [
      sessionId,
      new Date(nowMs),
      reason,
    ]);
    return { cancelled: true, bookings };
  });
}
