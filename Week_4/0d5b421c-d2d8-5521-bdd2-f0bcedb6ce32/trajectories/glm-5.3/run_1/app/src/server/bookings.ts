import type { Pool, PoolClient } from "pg";
import { REFUND_CUTOFF_HOURS } from "../shared/seed.js";
import { PAIR_BY_ID, roomName, TABLE_BY_ID, tableIdsForTarget } from "./floor.js";
import { isoWithLisbonOffset } from "./routes/validate.js";
import type { Booking } from "./types.js";

export interface DbBooking {
  reference: string;
  status: "booked" | "seated" | "completed" | "no_show" | "cancelled_refunded" | "cancelled_retained";
  source: "online" | "waitlist" | "walk_in";
  date: string;
  time: string;
  starts_at: Date;
  party_size: number;
  table_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  manage_token: string | null;
  deposit_cents: number;
  deposit_state: "none" | "paid" | "refunded" | "retained";
  kb_payment_id: string | null;
  kb_transaction_id: string | null;
  hold_id: string | null;
}

/** Booking row shape as returned by pg (timestamptz may arrive as a string). */
type RawBooking = Omit<DbBooking, "starts_at"> & { starts_at: Date | string };

export function coerceBooking(row: RawBooking): DbBooking {
  return { ...row, starts_at: new Date(row.starts_at) };
}

export function roomOfTable(tableId: string): string {
  const pair = PAIR_BY_ID.get(tableId);
  if (pair) return roomName(pair.room_id);
  return roomName(TABLE_BY_ID.get(tableId)?.room_id ?? "");
}

export function bookingToApi(b: DbBooking): Booking {
  const cutoff = b.source === "walk_in"
    ? null
    : new Date(b.starts_at.getTime() - REFUND_CUTOFF_HOURS * 3600_000).toISOString();
  return {
    reference: b.reference,
    status: b.status,
    source: b.source,
    date: b.date,
    time: b.time,
    starts_at: isoWithLisbonOffset(b.starts_at),
    party_size: b.party_size,
    table_id: b.table_id,
    room: roomOfTable(b.table_id),
    name: b.name,
    deposit: { amount_cents: b.deposit_cents, state: b.deposit_state },
    refund_cutoff: cutoff,
  };
}

export function tablesOf(b: { table_id: string }): string[] {
  return tableIdsForTarget(b.table_id);
}

/**
 * The database refuses two overlapping booked or seated windows on one table.
 * `client` is inside the caller's transaction.
 */
export async function overlapsBookedWindow(
  client: Pool | PoolClient, date: string, tableIds: string[], start: Date, end: Date,
): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM bookings
     WHERE date = $1 AND status IN ('booked','seated') AND table_id = ANY($2)
       AND tstzrange(starts_at, starts_at + make_interval(mins => $3)) && tstzrange($4, $5)
     LIMIT 1`,
    [date, tableIds, Math.round((end.getTime() - start.getTime()) / 60000), start, end],
  );
  return r.rows.length > 0;
}
