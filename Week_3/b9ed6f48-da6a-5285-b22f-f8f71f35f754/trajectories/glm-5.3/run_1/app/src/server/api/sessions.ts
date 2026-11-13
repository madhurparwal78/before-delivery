import type { App, User } from './app.ts';
import type { Currency } from '../core/money.ts';
import { formatPrice } from '../core/money.ts';
import { toDisplayDatetime, toOffsetIso } from '../core/time.ts';

/** Guided sessions: status and seats, decided by the server clock only. */

export type SessionStatus = 'on_sale' | 'closed' | 'held' | 'cancelled';

export interface SessionRow {
  id: string;
  title: string;
  starts_at: Date;
  duration_minutes: number;
  capacity: number;
  status: string;
}

export const BOOKING_CLOSES_MS = 30 * 60_000;

export interface DerivedSession {
  status: SessionStatus;
  bookingClosesAt: number;
  seatsLeft: number;
}

/** Seats left = capacity minus the seats of live bookings. */
export async function seatsLeft(app: App, sessionId: string, capacity: number): Promise<number> {
  const res = await app.pool.query(
    `SELECT COALESCE(SUM(seats), 0) AS taken FROM bookings WHERE session_id = $1 AND live`,
    [sessionId],
  );
  const taken = Number(res.rows[0]?.['taken'] ?? 0);
  return capacity - taken;
}

/** Status and seats exactly as the server reports them. */
export function deriveStatus(row: SessionRow, seats: number, nowMs: number): DerivedSession {
  if (row.status === 'cancelled') return { status: 'cancelled', bookingClosesAt: row.starts_at.getTime() - BOOKING_CLOSES_MS, seatsLeft: seats };
  const starts = row.starts_at.getTime();
  if (nowMs >= starts + row.duration_minutes * 60_000) {
    return { status: 'held', bookingClosesAt: starts - BOOKING_CLOSES_MS, seatsLeft: seats };
  }
  if (nowMs >= starts - BOOKING_CLOSES_MS) {
    return { status: 'closed', bookingClosesAt: starts - BOOKING_CLOSES_MS, seatsLeft: seats };
  }
  return { status: 'on_sale', bookingClosesAt: starts - BOOKING_CLOSES_MS, seatsLeft: seats };
}

export interface PublicSession {
  id: string;
  title: string;
  starts_at: string;
  starts_at_display: string;
  duration_minutes: number;
  capacity: number;
  seats_left: number;
  status: SessionStatus;
  booking_closes_at: string;
  price_minor?: number;
  currency?: string;
}

export function toPublicSession(row: SessionRow, derived: DerivedSession, price?: { minor: number; currency: string }): PublicSession {
  const out: PublicSession = {
    id: row.id,
    title: row.title,
    starts_at: toOffsetIso(row.starts_at.getTime()),
    starts_at_display: toDisplayDatetime(row.starts_at.getTime()),
    duration_minutes: row.duration_minutes,
    capacity: row.capacity,
    seats_left: derived.seatsLeft,
    status: derived.status,
    booking_closes_at: toOffsetIso(derived.bookingClosesAt),
  };
  if (price) {
    out.price_minor = price.minor;
    out.currency = price.currency;
  }
  return out;
}

/** Card currency: the supporter's Kill Bill account currency once fixed, else EUR. */
export async function cardCurrency(app: App, user: User | null): Promise<Currency> {
  if (!user) return 'EUR';
  const res = await app.pool.query(`SELECT currency FROM kb_accounts WHERE user_id = $1`, [user.id]);
  const row = res.rows[0];
  return row ? (row['currency'] as Currency) : 'EUR';
}

export function sessionStatusLine(status: SessionStatus): string {
  switch (status) {
    case 'on_sale': return 'On sale';
    case 'closed': return 'Closed';
    case 'held': return 'Held';
    case 'cancelled': return 'Cancelled';
  }
}

export function seatsLine(seatsLeft: number): string {
  return seatsLeft === 1 ? '1 seat left' : `${seatsLeft} seats left`;
}

export function priceLine(minor: number, currency: string): string {
  return `${formatPrice(minor, currency as Currency)} a seat`;
}
