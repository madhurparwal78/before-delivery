// A claim is one Valkey key per table per covered quarter-hour slot, owned by a hold, offer or walk-in.
import { rows, type Queryable } from "./db.js";
import { lisbonDate, lisbonTime } from "./lisbon.js";
import { coveredSlots, type TurnWindow } from "./domain/turn.js";
import { claimAll, key, releaseOwned } from "./valkey.js";

function claimKeys(tableIds: string[], window: TurnWindow): string[] {
  return tableIds.flatMap((tableId) =>
    coveredSlots(window).map((slot) => key(`hold:${tableId}:${lisbonDate(slot)}T${lisbonTime(slot)}`)),
  );
}

function offerMarkerKey(offerId: string): string {
  return key(`offer:${offerId}`);
}

/**
 * All of the window's keys on all of the tables, or none. A booking drops its keys once it commits,
 * so a claim that wins in Valkey is kept only when no booked or seated window overlaps it.
 */
export async function claimWindow(db: Queryable, owner: string, tableIds: string[], window: TurnWindow, ttlMs: number): Promise<boolean> {
  if (!(await claimAll(claimKeys(tableIds, window), owner, ttlMs))) return false;
  const booked = await rows(
    db,
    "SELECT 1 FROM booking_tables WHERE table_id = ANY($1) AND occupied && tstzrange($2, $3) LIMIT 1",
    [tableIds, window.start, window.end],
  );
  if (booked.length === 0) return true;
  await releaseWindow(owner, tableIds, window);
  return false;
}

export async function releaseWindow(owner: string, tableIds: string[], window: TurnWindow): Promise<void> {
  await releaseOwned(claimKeys(tableIds, window), owner);
}

export async function markOffer(offerId: string, ttlMs: number): Promise<void> {
  await claimAll([offerMarkerKey(offerId)], offerId, ttlMs);
}

export async function unmarkOffer(offerId: string): Promise<void> {
  await releaseOwned([offerMarkerKey(offerId)], offerId);
}
