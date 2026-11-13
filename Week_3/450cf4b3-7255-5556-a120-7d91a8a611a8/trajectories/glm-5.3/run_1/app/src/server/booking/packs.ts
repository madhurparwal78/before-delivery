import { Tx, PackRow, BookingRow } from '../store.js';
import { KitchenClock } from '../domain/kitchen.js';
import { newId } from '../domain/crypto.js';
import { cutoffFor } from '../domain/rules.js';

export type MovementKind = 'purchase' | 'booking_debit' | 'move_adjustment' | 'cancellation_credit' | 'refund';

// One ledger movement always writes equal and opposite pack and kitchen entries.
export async function writeMovement(tx: Tx, kind: MovementKind, packId: string, minutes: number, bookingId: string | null, now: number): Promise<string> {
  const id = newId();
  await tx.query(
    `INSERT INTO movements (id, kind, pack_id, booking_id, at) VALUES ($1,$2,$3,$4,$5)`,
    [id, kind, packId, bookingId, now],
  );
  await tx.query(
    `INSERT INTO ledger_entries (movement_id, side, minutes, created_at) VALUES ($1,'pack',$2,$3), ($1,'kitchen',$4,$3)`,
    [id, minutes, now, -minutes],
  );
  return id;
}

export async function packBalance(tx: Tx, packId: string): Promise<number> {
  const r = await tx.query(
    `SELECT COALESCE(SUM(e.minutes),0)::int AS balance FROM ledger_entries e
     JOIN movements m ON m.id=e.movement_id WHERE e.side='pack' AND m.pack_id=$1`,
    [packId],
  );
  return r.rows[0].balance;
}

// Live holds reserve their minutes on their pack.
export async function packHeldMinutes(tx: Tx, packId: string, now: number): Promise<number> {
  const r = await tx.query(
    `SELECT COALESCE(SUM(
        ((b."end"-b.start)/60000) * (CASE WHEN b.shelf_id IS NULL THEN 1 ELSE 2 END)
      ),0)::int AS held
     FROM bookings b
     WHERE b.pack_id=$1 AND b.status='held' AND b.hold_expires_at > $2`,
    [packId, now],
  );
  return r.rows[0].held;
}

export async function packAvailable(tx: Tx, packId: string, now: number): Promise<number> {
  return (await packBalance(tx, packId)) - (await packHeldMinutes(tx, packId, now));
}

// The earliest-purchased active pack whose available minutes cover the need.
export async function choosePack(tx: Tx, tenantId: string, minutes: number, now: number): Promise<PackRow | null> {
  const r = await tx.query(
    `SELECT p.*,
      COALESCE((
        SELECT SUM(e.minutes) FROM ledger_entries e JOIN movements m ON m.id=e.movement_id
        WHERE e.side='pack' AND m.pack_id=p.id
      ),0)::int AS balance,
      COALESCE((
        SELECT SUM(((b."end"-b.start)/60000) * (CASE WHEN b.shelf_id IS NULL THEN 1 ELSE 2 END))
        FROM bookings b WHERE b.pack_id=p.id AND b.status='held' AND b.hold_expires_at > $2
      ),0)::int AS held
     FROM packs p WHERE p.tenant_id=$1 AND p.status='active'
     ORDER BY p.purchased_at, p.id`,
    [tenantId, now],
  );
  for (const pack of r.rows as Array<PackRow & { balance: number; held: number }>) {
    if (pack.balance - pack.held >= minutes) return pack;
  }
  return null;
}

// Booking minutes: span minutes times the number of stations occupied.
export function bookingMinutesOf(b: Pick<BookingRow, 'start' | 'end' | 'shelf_id'>): number {
  return Math.round((b.end - b.start) / 60_000) * (b.shelf_id === null ? 1 : 2);
}

export function cutoffOf(clock: KitchenClock, b: Pick<BookingRow, 'start'>): number {
  return cutoffFor(clock, b.start);
}

export function cancelCreditMinutes(b: BookingRow, now: number, cutoff: number): number | null {
  if (b.status !== 'confirmed') return null;
  if (now <= cutoff) return b.debited_minutes ?? 0;
  return 0;
}

export async function packHasUpcomingBooking(tx: Tx, packId: string): Promise<boolean> {
  const r = await tx.query(
    `SELECT 1 FROM bookings WHERE pack_id=$1 AND status IN ('confirmed','checked_in') LIMIT 1`,
    [packId],
  );
  return r.rows.length > 0;
}
