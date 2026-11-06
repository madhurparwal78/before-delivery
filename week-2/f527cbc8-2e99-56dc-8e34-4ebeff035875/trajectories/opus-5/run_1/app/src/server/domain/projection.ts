import { query, type Db } from '../db.js';
import type { Role } from '../auth.js';
import type { StreamRole } from '../stream.js';

/**
 * Role field projection. A barn day's booking list returns exactly the published field
 * set for the caller's role, and a barn manager's rows carry only slot time, horse name
 * and stall.
 */
export interface BookingRowSource {
  booking_id: string;
  number: number;
  slot_time: string;
  slot_position: number;
  horse_id: string;
  horse_name: string;
  stall: string;
  status: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string | null;
  trip_share_cents: number | null;
  visit_id: string | null;
  visit_status: string | null;
  invoice_status: string | null;
  invoice_total_cents: number | null;
}

const ROW_SQL = `
  SELECT bk.id AS booking_id, bk.number::int AS number, s.slot_time, s.position AS slot_position,
         h.id AS horse_id, h.name AS horse_name, h.stall, bk.status,
         o.name AS owner_name, o.email AS owner_email, o.phone AS owner_phone,
         bk.share_cents AS trip_share_cents,
         v.id AS visit_id, v.status AS visit_status,
         inv.status AS invoice_status, inv.total_cents AS invoice_total_cents
  FROM bookings bk
  JOIN slots s ON s.id = bk.slot_id
  JOIN horses h ON h.id = bk.horse_id
  JOIN users o ON o.id = bk.owner_id
  LEFT JOIN visits v ON v.booking_id = bk.id
  LEFT JOIN invoices inv ON (
    (inv.visit_id = v.id AND inv.kind = 'visit')
    OR (inv.booking_id = bk.id AND inv.kind = 'trip')
  )
  WHERE bk.barn_day_id = $1 AND bk.status NOT IN ('held','released','lapsed','removed')
  ORDER BY s.position, bk.number`;

export async function bookingRowSources(db: Db, barnDayId: string): Promise<BookingRowSource[]> {
  return await query<BookingRowSource>(db, ROW_SQL, [barnDayId]);
}

export async function bookingRowSource(
  db: Db,
  barnDayId: string,
  bookingId: string,
): Promise<BookingRowSource | null> {
  const rows = await query<BookingRowSource>(
    db,
    `${ROW_SQL.replace('WHERE bk.barn_day_id = $1 AND', 'WHERE bk.barn_day_id = $1 AND bk.id = $2 AND')}`,
    [barnDayId, bookingId],
  );
  return rows[0] ?? null;
}

/** Rows a barn manager may see: only bookings that are confirmed, worked or no-show. */
export function visibleToBarnManager(source: BookingRowSource): boolean {
  return source.status === 'confirmed' || source.status === 'worked' || source.status === 'no_show';
}

export function projectBookingRow(
  source: BookingRowSource,
  role: Role | StreamRole,
): Record<string, unknown> {
  switch (role) {
    case 'farrier':
      return {
        booking_id: source.booking_id,
        number: source.number,
        slot_time: source.slot_time,
        horse_id: source.horse_id,
        horse_name: source.horse_name,
        stall: source.stall,
        status: source.status,
        owner_name: source.owner_name,
        owner_email: source.owner_email,
        owner_phone: source.owner_phone,
        trip_share_cents: source.trip_share_cents,
        visit_id: source.visit_id,
        visit_status: source.visit_status,
        invoice_status: source.invoice_status,
        invoice_total_cents: source.invoice_total_cents,
      };
    case 'apprentice':
      return {
        booking_id: source.booking_id,
        slot_time: source.slot_time,
        horse_id: source.horse_id,
        horse_name: source.horse_name,
        stall: source.stall,
        status: source.status,
        visit_id: source.visit_id,
        visit_status: source.visit_status,
      };
    case 'barn_manager':
      return {
        slot_time: source.slot_time,
        horse_name: source.horse_name,
        stall: source.stall,
      };
    default:
      return {};
  }
}
