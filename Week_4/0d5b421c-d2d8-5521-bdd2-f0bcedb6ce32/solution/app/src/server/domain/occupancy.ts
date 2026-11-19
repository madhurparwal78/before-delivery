// Who occupies which table when: live holds, live offers and booked or seated bookings.
// This is the one place occupancy is read; covers free, the plan and the host floor all derive from it.
import { catalog, type Target } from "../catalog.js";
import { rows, type Queryable } from "../db.js";
import { windowsOverlap, type TurnWindow } from "./turn.js";

type Occupant =
  | { kind: "booking"; reference: string; status: "booked" | "seated" }
  | { kind: "hold"; holdId: string; partySize: number; expiresAt: Date }
  | { kind: "offer"; offerId: string; expiresAt: Date };

interface Occupation {
  tableIds: string[];
  window: TurnWindow;
  occupant: Occupant;
}

export class Occupancy {
  constructor(readonly occupations: Occupation[]) {}

  /** The occupation of one table at an instant, if any. */
  at(tableId: string, instant: Date): Occupation | undefined {
    return this.occupations.find(
      (occupation) =>
        occupation.tableIds.includes(tableId) && occupation.window.start <= instant && instant < occupation.window.end,
    );
  }

  /** Free means no occupation on any of the target's tables overlaps the window. */
  isFree(target: Target, window: TurnWindow): boolean {
    return !this.occupations.some(
      (occupation) =>
        occupation.tableIds.some((tableId) => target.tableIds.includes(tableId)) &&
        windowsOverlap(occupation.window, window),
    );
  }
}

interface WindowRow {
  table_ids: string[];
  window_start: Date;
  window_end: Date;
}

/** Everything occupying a table at some instant of [from, to), judged at `at` for holds and offers. */
export async function loadOccupancy(db: Queryable, from: Date, to: Date, at: Date): Promise<Occupancy> {
  const bookings = await rows<WindowRow & { reference: string; status: "booked" | "seated" }>(
    db,
    `SELECT DISTINCT ON (b.reference) b.reference, b.status, b.table_ids,
            lower(t.occupied) AS window_start, upper(t.occupied) AS window_end
       FROM booking_tables t JOIN bookings b USING (reference)
      WHERE t.occupied && tstzrange($1, $2)`,
    [from, to],
  );
  const holds = await rows<WindowRow & { hold_id: string; party_size: number; expires_at: Date }>(
    db,
    `SELECT hold_id, party_size, table_ids, window_start, window_end, expires_at FROM holds
      WHERE status = 'live' AND expires_at > $3 AND window_start < $2 AND window_end > $1`,
    [from, to, at],
  );
  const offers = await rows<WindowRow & { offer_id: string; expires_at: Date }>(
    db,
    `SELECT offer_id, table_ids, window_start, window_end, expires_at FROM offers
      WHERE status = 'offered' AND expires_at > $3 AND window_start < $2 AND window_end > $1`,
    [from, to, at],
  );
  const window = (row: WindowRow): TurnWindow => ({ start: row.window_start, end: row.window_end });
  return new Occupancy([
    ...bookings.map((row): Occupation => ({
      tableIds: row.table_ids,
      window: window(row),
      occupant: { kind: "booking", reference: row.reference, status: row.status },
    })),
    ...holds.map((row): Occupation => ({
      tableIds: row.table_ids,
      window: window(row),
      occupant: { kind: "hold", holdId: row.hold_id, partySize: row.party_size, expiresAt: row.expires_at },
    })),
    ...offers.map((row): Occupation => ({
      tableIds: row.table_ids,
      window: window(row),
      occupant: { kind: "offer", offerId: row.offer_id, expiresAt: row.expires_at },
    })),
  ]);
}

interface CoversFree {
  total: number;
  rooms: { roomId: string; name: string; seats: number; coversFree: number }[];
}

/** The one shared count: a room's covers free is the sum of the maximum seats of its unoccupied tables. */
export function coversFree(occupancy: Occupancy, instant: Date): CoversFree {
  const rooms = catalog().rooms.map((room) => ({
    roomId: room.roomId,
    name: room.name,
    seats: room.seats,
    coversFree: room.tables
      .filter((table) => occupancy.at(table.tableId, instant) === undefined)
      .reduce((sum, table) => sum + table.maxSeats, 0),
  }));
  return { total: rooms.reduce((sum, room) => sum + room.coversFree, 0), rooms };
}
