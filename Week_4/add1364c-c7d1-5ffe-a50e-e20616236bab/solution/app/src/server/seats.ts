import { db, write } from "./db.js";
import { record, type Actor } from "./audit.js";
import { emitToDesk } from "./events.js";
import {
  BillingUnavailable,
  buySeat,
  cancelSeat,
  ensureReady,
  findSeat,
  purchaseConfirmed,
  releaseConfirmed,
  type Seat,
} from "./killbill.js";
import type { PersonRow } from "./model.js";
import { now } from "./clock.js";

/** A seat counts only once Kill Bill confirms it. These are the waiting-change workflows. */
const inFlight = new Map<string, Promise<boolean>>();
const POLL_MS = 400;

async function settle(until: number, ready: () => Promise<boolean>): Promise<boolean> {
  for (;;) {
    if (await ready()) return true;
    if (Date.now() + POLL_MS >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * One pass over a seat change: makes the next request Kill Bill needs (buy a missing seat, cancel a confirmed seat
 * being released) and says whether Kill Bill now reports the change confirmed. Every step re-reads the bundle, so
 * repeating a pass never buys or cancels twice.
 */
async function advance(handle: string, change: "add" | "release"): Promise<boolean> {
  let seat: Seat | null = await findSeat(handle);
  if (!seat) {
    await buySeat(handle);
    seat = await findSeat(handle);
  }
  if (change === "add") return purchaseConfirmed(seat);
  if (purchaseConfirmed(seat)) {
    await cancelSeat(seat.subscriptionId);
    seat = await findSeat(handle);
  }
  return releaseConfirmed(seat);
}

/** Records the confirmed seat state once, audits it, and tells the office pages. */
async function settleSeat(person: PersonRow, change: "add" | "release", actor: Actor): Promise<void> {
  const from = change === "add" ? "waiting_on_billing" : "release_waiting";
  const to = change === "add" ? "confirmed" : "released";
  await write(async (tx) => {
    const done = await tx.one<{ seat_silent: boolean }>("SELECT seat_silent FROM people WHERE id = $1 AND seat = $2", [person.id, from]);
    if (!done) return;
    await tx.query("UPDATE people SET seat = $2, seat_silent = false, seat_since = $3 WHERE id = $1", [person.id, to, now()]);
    if (!done.seat_silent) {
      await record(tx, actor, change === "add" ? "seat_confirmed" : "seat_released", { kind: "person", id: person.id, name: person.full_name });
    }
    tx.after(() => {
      emitToDesk("billing-changed", {});
      emitToDesk("seat-confirmed", { person_id: person.id, name: person.full_name, change });
    });
  });
}

/**
 * Asks Kill Bill for the pending seat change of a person and waits until `until` for it to be confirmed.
 * Returns true when confirmed. Kill Bill being unreachable is not an error: the change stays waiting.
 */
export async function driveSeat(personId: string, until: number, actor: Actor): Promise<boolean> {
  for (let running = inFlight.get(personId); running; running = inFlight.get(personId)) await running.catch(() => false);
  const run = drive(personId, until, actor).finally(() => inFlight.delete(personId));
  inFlight.set(personId, run);
  return run;
}

async function drive(personId: string, until: number, actor: Actor): Promise<boolean> {
  try {
    const person = await db.one<PersonRow>("SELECT * FROM people WHERE id = $1", [personId]);
    if (!person) return false;
    if (person.seat === "confirmed" || person.seat === "released") return true;
    const change = person.seat === "waiting_on_billing" ? "add" : "release";
    if (!(await settle(until, () => advance(person.handle, change)))) return false;
    await settleSeat(person, change, actor);
    return true;
  } catch (error) {
    if (error instanceof BillingUnavailable) return false;
    throw error;
  }
}

/** The seat change is waiting: say so in the audit trail and on the office pages. */
export async function markWaiting(person: PersonRow, actor: Actor): Promise<void> {
  await write(async (tx) => {
    await record(tx, actor, "seat_waiting", { kind: "person", id: person.id, name: person.full_name });
    tx.after(() => emitToDesk("billing-changed", {}));
  });
}

export const WAIT_FOR_BILLING_MS = 3500;

/** Re-checks every waiting change, all at once, one pass each; runs every 2 seconds without a restart. */
export async function retryWaiting(): Promise<void> {
  const waiting = await db.query<{ id: string }>("SELECT id FROM people WHERE seat IN ('waiting_on_billing','release_waiting')");
  if (waiting.length === 0) return;
  try {
    await ensureReady();
  } catch {
    return;
  }
  await Promise.all(waiting.filter((row) => !inFlight.has(row.id)).map((row) => driveSeat(row.id, Date.now(), "system")));
}
