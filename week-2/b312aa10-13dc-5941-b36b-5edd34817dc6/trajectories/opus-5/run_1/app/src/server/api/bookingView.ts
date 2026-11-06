/** Building the booking context a response needs, and applying lapses that are due. */
import type { Queryable } from '../db/pool.js';
import { dueLapse } from '../domain/transitions.js';
import type { Actor } from '../domain/transitions.js';
import type { BookingRow, Kitchen } from '../domain/types.js';
import { setStatus } from '../store/bookings.js';
import { closedMonths } from '../store/months.js';
import type { BookingContext } from './shapes.js';

export async function bookingContext(
  client: Queryable,
  kitchen: Kitchen,
  actor: Actor,
  nowMs: number,
): Promise<BookingContext> {
  const stations = await client.query<{ id: string; name: string }>(
    `select id, name from stations where kitchen_id = $1`,
    [kitchen.id],
  );
  const members = await client.query<{ id: string; business_name: string }>(
    `select id, business_name from members where kitchen_id = $1`,
    [kitchen.id],
  );
  const pending = await client.query<{ booking_id: string }>(
    `select distinct booking_id from billing_items
      where kitchen_id = $1 and recorded_at is null`,
    [kitchen.id],
  );
  return {
    kitchen,
    stationNames: new Map(stations.rows.map((row) => [row.id, row.name])),
    businessNames: new Map(members.rows.map((row) => [row.id, row.business_name])),
    pendingBookingIds: new Set(pending.rows.map((row) => row.booking_id)),
    closedMonths: new Set(await closedMonths(client, kitchen.id)),
    actor,
    nowMs,
  };
}

/**
 * Every request that reads or acts on a booking first applies the automatic
 * hold lapse or no-show already due.
 */
export async function applyDueLapse(
  client: Queryable,
  booking: BookingRow,
  nowMs: number,
  monthClosed: boolean,
): Promise<BookingRow> {
  const lapse = dueLapse(booking, nowMs, monthClosed);
  if (!lapse) return booking;
  return setStatus(client, booking.id, lapse.status);
}

export async function applyDueLapses(
  client: Queryable,
  bookings: BookingRow[],
  nowMs: number,
  closed: Set<string>,
): Promise<BookingRow[]> {
  const updated: BookingRow[] = [];
  for (const booking of bookings) {
    updated.push(await applyDueLapse(client, booking, nowMs, closed.has(booking.month)));
  }
  return updated;
}
