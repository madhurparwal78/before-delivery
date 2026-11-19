import type { Pool } from "pg";
import { SLOT_TIMES } from "../shared/seed.js";
import { fitsBySeatRange, tableIdsForTarget, PAIR_BY_ID } from "./floor.js";
import { lisbonSlotInstant } from "./config.js";
import { overlaps, loadWindowsForDate, type OccupyingWindow } from "./occupancy.js";
import type { DateString } from "./types.js";
import { turnWindow } from "./floor.js";

export interface WaitlistEntryLike {
  entry_id: string;
  email_lower: string;
  name: string;
  date: DateString;
  party_size: number;
  earliest: string;
  latest: string;
  status: string;
}

/**
 * Choose who is offered a freed table: the earliest waiting entry (strict join
 * order) whose party fits the freed table by seat range — or, for 7 or 8 guests,
 * a joinable pair the freed table completes — and some bookable slot in its window
 * has the table free for the party's whole window.
 */
export async function chooseOffer(
  pool: Pool, date: DateString, freedTableId: string, now: Date,
): Promise<{ entry: WaitlistEntryLike; time: string } | null> {
  const entries = await pool.query<WaitlistEntryLike>(
    `SELECT entry_id, email_lower, name, date, party_size, earliest, latest, status
     FROM waitlist_entries
     WHERE date = $1 AND status = 'waiting'
     ORDER BY joined_at, entry_id`,
    [date],
  );
  const windows = await loadWindowsForDate(pool, date, now);
  for (const entry of entries.rows) {
    const slot = earliestFittingSlot(entry, freedTableId, windows, now);
    if (slot) return { entry, time: slot };
  }
  return null;
}

/**
 * The earliest bookable slot in the entry's window where the freed table can host
 * the party for its whole window.
 */
function earliestFittingSlot(
  entry: WaitlistEntryLike, freedTableId: string, windows: OccupyingWindow[], now: Date,
): string | null {
  // The target the freed table completes: the table itself if it fits, or the pair it belongs to.
  const candidateTargets: string[] = [];
  if (fitsBySeatRange(freedTableId, entry.party_size)) candidateTargets.push(freedTableId);
  for (const p of Array.from(PAIR_BY_ID.values())) {
    if (p.tables.includes(freedTableId) && p.min_seats <= entry.party_size && entry.party_size <= p.max_seats) {
      candidateTargets.push(p.pair_id);
    }
  }
  if (candidateTargets.length === 0) return null;

  const startIdx = SLOT_TIMES.indexOf(entry.earliest);
  const endIdx = SLOT_TIMES.indexOf(entry.latest);
  if (startIdx < 0 || endIdx < 0) return null;
  const leadMs = 60 * 60_000;
  for (let i = startIdx; i <= endIdx; i++) {
    const t = SLOT_TIMES[i];
    const start = lisbonSlotInstant(entry.date, t);
    if (start.getTime() < now.getTime() + leadMs) continue;
    const { end } = turnWindow(start, entry.party_size);
    let ok = false;
    for (const target of candidateTargets) {
      const tables = tableIdsForTarget(target);
      if (!overlaps(windows, tables, start, end)) { ok = true; break; }
    }
    if (ok) return t;
  }
  return null;
}

