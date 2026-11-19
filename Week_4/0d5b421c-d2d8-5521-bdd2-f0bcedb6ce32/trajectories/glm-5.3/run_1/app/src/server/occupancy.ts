import type { Pool } from "pg";
import { TABLES, ROOMS, PAIRS, fitsBySeatRange, tableIdsForTarget, maxSeatsForTarget, turnWindow } from "./floor.js";
import { lisbonSlotInstant } from "./config.js";
import type { DateString } from "./types.js";

export interface OccupyingWindow {
  owner_kind: "hold" | "offer" | "walkin" | "booking";
  owner_id: string;
  table_id: string;
  start: Date;
  end: Date;
  party_size: number;
}

/**
 * Read every occupying window on a date: live holds, live offers, booked and seated
 * bookings (including seated walk-ins). Ended holds, lapsed offers, cancelled,
 * completed and no-show records do not occupy. A cleared seated booking's window
 * ends at the moment it was cleared.
 */
export async function loadWindowsForDate(pool: Pool, date: DateString, now: Date): Promise<OccupyingWindow[]> {
  const out: OccupyingWindow[] = [];

  const holds = await pool.query<{ table_id: string; hold_id: string; party_size: number; time: string; expires_at: Date }>(
    `SELECT table_id, hold_id, party_size, time, expires_at FROM holds WHERE date = $1 AND status = 'live'`,
    [date],
  );
  for (const h of holds.rows) {
    if (now.getTime() >= new Date(h.expires_at).getTime()) continue;
    const start = lisbonSlotInstant(date, h.time);
    const { end } = turnWindow(start, h.party_size);
    out.push({ owner_kind: "hold", owner_id: h.hold_id, table_id: h.table_id, start, end, party_size: h.party_size });
  }

  const offers = await pool.query<{ table_id: string; offer_id: string; party_size: number; time: string; expires_at: Date }>(
    `SELECT table_id, offer_id, party_size, time, expires_at FROM offers WHERE date = $1 AND status = 'offered'`,
    [date],
  );
  for (const o of offers.rows) {
    if (now.getTime() >= new Date(o.expires_at).getTime()) continue;
    const start = lisbonSlotInstant(date, o.time);
    const { end } = turnWindow(start, o.party_size);
    out.push({ owner_kind: "offer", owner_id: o.offer_id, table_id: o.table_id, start, end, party_size: o.party_size });
  }

  const bookings = await pool.query<{ table_id: string; reference: string; party_size: number; time: string; starts_at: Date; status: string; cleared_at: Date | null }>(
    `SELECT table_id, reference, party_size, time, starts_at, status, cleared_at FROM bookings
     WHERE date = $1 AND status IN ('booked','seated')`,
    [date],
  );
  for (const b of bookings.rows) {
    const start = lisbonSlotInstant(date, b.time);
    const full = turnWindow(start, b.party_size);
    const end = b.status === "seated" && b.cleared_at ? new Date(min(b.cleared_at, full.end)) : full.end;
    out.push({ owner_kind: "walkin", owner_id: b.reference, table_id: b.table_id, start, end, party_size: b.party_size });
  }
  return out;
}

function min(a: Date | string, b: Date): number {
  const av = typeof a === "string" ? new Date(a).getTime() : a.getTime();
  return Math.min(av, b.getTime());
}

/** True when any window occupies the target's tables over the party's whole window. */
export function overlaps(windows: OccupyingWindow[], tableIds: string[], start: Date, end: Date): boolean {
  return windows.some((w) => {
    const wTables = tableIdsForTarget(w.table_id);
    if (!wTables.some((t) => tableIds.includes(t))) return false;
    return w.start.getTime() < end.getTime() && start.getTime() < w.end.getTime();
  });
}

/** Tables occupied at a slot's start instant. */
export function occupiedTableIds(windows: OccupyingWindow[], slotInstant: Date): Set<string> {
  const busy = new Set<string>();
  for (const w of windows) {
    if (w.start.getTime() <= slotInstant.getTime() && slotInstant.getTime() < w.end.getTime()) {
      for (const t of tableIdsForTarget(w.table_id)) busy.add(t);
    }
  }
  return busy;
}

/**
 * The one shared covers count: a room's covers free at a slot is the sum of the
 * maximum seats of its tables that are not occupied at that slot's start instant.
 */
export function coversFreeByRoom(windows: OccupyingWindow[], slotInstant: Date): Map<string, number> {
  const busy = occupiedTableIds(windows, slotInstant);
  const out = new Map<string, number>();
  for (const room of ROOMS) {
    let free = 0;
    for (const t of room.tables) {
      if (!busy.has(t.table_id)) free += t.max_seats;
    }
    out.set(room.room_id, free);
  }
  return out;
}

export function totalCoversFree(covers: Map<string, number>): number {
  let total = 0;
  for (const v of covers.values()) total += v;
  return total;
}

/**
 * Candidate targets for a party that fit by seat range and are free for the whole
 * window, plus the smallest maximum seats among them.
 */
export function eligibleTargets(
  windows: OccupyingWindow[], date: DateString, time: string, partySize: number,
): { fitsFree: string[]; smallestMaxSeats: number | null } {
  const start = lisbonSlotInstant(date, time);
  const { end } = turnWindow(start, partySize);
  const fitsFree: string[] = [];
  const candidates = [...TABLES.map((t) => t.table_id).filter((id) => fitsBySeatRange(id, partySize)),
    ...(partySize >= 7 ? PAIRS.map((p) => p.pair_id) : [])];
  for (const id of candidates) {
    const tables = tableIdsForTarget(id);
    if (!overlaps(windows, tables, start, end)) fitsFree.push(id);
  }
  let smallest: number | null = null;
  for (const id of fitsFree) {
    const m = maxSeatsForTarget(id);
    if (smallest === null || m < smallest) smallest = m;
  }
  return { fitsFree, smallestMaxSeats: smallest };
}
