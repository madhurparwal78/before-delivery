import { query, type Db } from '../db';
import { addDaysToDate, lisbonInstant } from '../time';
import type { Layout, Unit } from './floor';
import { windowsConflict, type TurnWindow } from './rules';

export type OccupancyKind = 'hold' | 'offer' | 'booking';

/** One live occupation of one table: a hold, an offer, or a booked or seated booking. */
export interface ActiveWindow {
  kind: OccupancyKind;
  tableId: string;
  unitId: string;
  start: Date;
  end: Date;
  partySize: number;
  time: string;
  date: string;
  holdId: string | null;
  offerId: string | null;
  bookingId: string | null;
  bookingStatus: string | null;
  expiresAt: Date | null;
  reference: string | null;
  name: string | null;
}

interface WindowRow {
  kind: OccupancyKind;
  table_id: string;
  unit_id: string;
  start_at: Date;
  end_at: Date;
  party_size: number;
  time: string;
  date: string;
  hold_id: string | null;
  offer_id: string | null;
  booking_id: string | null;
  booking_status: string | null;
  expires_at: Date | null;
  reference: string | null;
  name: string | null;
}

const WINDOWS_SQL = `
select 'booking' as kind, bt.table_id, b.unit_id, lower(bt.during) as start_at,
       upper(bt.during) as end_at, b.party_size, b.time, to_char(b.date, 'YYYY-MM-DD') as date,
       null::text as hold_id, null::text as offer_id, b.id::text as booking_id,
       b.status as booking_status, null::timestamptz as expires_at, b.reference, b.name
from booking_tables bt
join bookings b on b.id = bt.booking_id
where bt.active and b.status in ('booked', 'seated') and bt.during && tstzrange($1, $2)
union all
select 'offer' as kind, ot.table_id, o.unit_id, o.window_start as start_at,
       o.window_end as end_at, o.party_size, o.time, to_char(o.date, 'YYYY-MM-DD') as date,
       null::text as hold_id, o.offer_id, null::text as booking_id,
       null::text as booking_status, o.expires_at, null::text as reference, null::text as name
from offer_tables ot
join offers o on o.offer_id = ot.offer_id
where o.status = 'offered' and o.expires_at > $3
  and tstzrange(o.window_start, o.window_end) && tstzrange($1, $2)
union all
select 'hold' as kind, ht.table_id, h.unit_id, h.window_start as start_at,
       h.window_end as end_at, h.party_size, h.time, to_char(h.date, 'YYYY-MM-DD') as date,
       h.hold_id, null::text as offer_id, null::text as booking_id,
       null::text as booking_status, h.expires_at, null::text as reference, null::text as name
from hold_tables ht
join holds h on h.hold_id = ht.hold_id
where h.status = 'live' and h.expires_at > $3
  and tstzrange(h.window_start, h.window_end) && tstzrange($1, $2)
`;

export async function activeWindows(
  db: Db,
  from: Date,
  to: Date,
  now: Date,
): Promise<ActiveWindow[]> {
  const result = await query<WindowRow>(db, WINDOWS_SQL, [from, to, now]);
  return result.rows.map((row) => ({
    kind: row.kind,
    tableId: row.table_id,
    unitId: row.unit_id,
    start: new Date(row.start_at),
    end: new Date(row.end_at),
    partySize: row.party_size,
    time: row.time,
    date: row.date,
    holdId: row.hold_id,
    offerId: row.offer_id,
    bookingId: row.booking_id,
    bookingStatus: row.booking_status,
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
    reference: row.reference,
    name: row.name,
  }));
}

/** The instants an evening's windows can touch. */
export function eveningRange(date: string): { from: Date; to: Date } {
  return {
    from: lisbonInstant(date, '17:00'),
    to: lisbonInstant(addDaysToDate(date, 1), '03:00'),
  };
}

export async function eveningWindows(db: Db, date: string, now: Date): Promise<ActiveWindow[]> {
  const range = eveningRange(date);
  return activeWindows(db, range.from, range.to, now);
}

export function occupiedTableIds(windows: ActiveWindow[], instant: Date): Set<string> {
  const occupied = new Set<string>();
  for (const window of windows) {
    if (window.start.getTime() <= instant.getTime() && instant.getTime() < window.end.getTime()) {
      occupied.add(window.tableId);
    }
  }
  return occupied;
}

export function unitFreeForWindow(
  windows: ActiveWindow[],
  unit: Unit,
  window: TurnWindow,
  ignore: { holdId?: string; offerId?: string } = {},
): boolean {
  for (const existing of windows) {
    if (!unit.tableIds.includes(existing.tableId)) continue;
    if (ignore.holdId && existing.holdId === ignore.holdId) continue;
    if (ignore.offerId && existing.offerId === ignore.offerId) continue;
    if (windowsConflict({ start: existing.start, end: existing.end }, window)) return false;
  }
  return true;
}

export interface CoversFree {
  total: number;
  byRoom: Map<string, number>;
}

/** The one shared covers-free count: free tables' maximum seats, by room and overall. */
export function coversFree(layout: Layout, occupied: Set<string>): CoversFree {
  const byRoom = new Map<string, number>();
  let total = 0;
  for (const room of layout.rooms) {
    let roomFree = 0;
    for (const table of room.tables) {
      if (!occupied.has(table.tableId)) roomFree += table.maxSeats;
    }
    byRoom.set(room.roomId, roomFree);
    total += roomFree;
  }
  return { total, byRoom };
}
