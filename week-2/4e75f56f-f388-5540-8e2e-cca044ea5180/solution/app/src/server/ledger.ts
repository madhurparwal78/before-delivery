// The bench ledger: who occupies which bench, the seats-remaining count, hold expiry and
// waitlist offers. Every change runs inside a transaction holding the ledger lock.
import { config } from "./config.js";
import { many, one, oneRow, type Db, type Queryable } from "./db.js";
import { enqueueMail } from "./mail.js";
import { transition } from "./reservations.js";
import {
  ACTIVE_STATES,
  ATELIER_CAP,
  BENCH_LABELS,
  SEATS_TOTAL,
  SOLD_STATES,
  atelierRoom,
  tierOf,
  type ReservationState,
  type Tier,
} from "./rules.js";

interface Occupant {
  bench: string;
  account_id: string;
  state: ReservationState | "offered";
}

/** Benches that are held (a live hold, a live offer, a claimed upgrade target) or sold. */
async function occupants(db: Queryable): Promise<Occupant[]> {
  return many<Occupant>(
    db,
    `SELECT bench, buyer_id AS account_id, state FROM reservations WHERE state = ANY($1)
     UNION ALL
     SELECT upgrade_target, buyer_id, 'held' FROM reservations WHERE upgrade_target IS NOT NULL AND state = ANY($1)
     UNION ALL
     SELECT bench, account_id, 'offered' FROM waitlist_entries WHERE state = 'offered'`,
    [ACTIVE_STATES],
  );
}

interface Inventory {
  seatsRemaining: number;
  benchRemaining: number;
  atelier: { remaining: number; active: number; cap: number; soldOut: boolean };
  held: number;
  sold: number;
  occupied: Map<string, Occupant>;
}

function isSold(occupant: Occupant): boolean {
  return occupant.state !== "offered" && SOLD_STATES.includes(occupant.state);
}

/** The one computation of seats remaining and per-tier counts. */
function inventory(found: readonly Occupant[]): Inventory {
  const occupied = new Map(found.map((o) => [o.bench, o]));
  const open = BENCH_LABELS.filter((label) => !occupied.has(label));
  const activeAtelier = found.filter((o) => tierOf(o.bench) === "atelier").length;
  const room = atelierRoom(activeAtelier);
  return {
    seatsRemaining: SEATS_TOTAL - occupied.size,
    benchRemaining: open.filter((label) => tierOf(label) === "bench").length,
    atelier: {
      remaining: Math.min(open.filter((label) => tierOf(label) === "atelier").length, room),
      active: activeAtelier,
      cap: ATELIER_CAP,
      soldOut: room === 0,
    },
    held: found.filter((o) => !isSold(o)).length,
    sold: found.filter(isSold).length,
    occupied,
  };
}

export function tierRemaining(stock: Inventory, tier: Tier): number {
  return tier === "bench" ? stock.benchRemaining : stock.atelier.remaining;
}

export async function currentInventory(db: Queryable): Promise<Inventory> {
  return inventory(await occupants(db));
}

/** Releases lapsed holds and offers, then offers freed benches to the waitlists. */
export async function sweep(db: Db, now: Date): Promise<void> {
  const expired = await many<{ id: string; state: ReservationState; bench: string }>(
    db,
    `SELECT id, state, bench FROM reservations WHERE state = 'held' AND hold_expires_at <= $1 AND payment_pending IS NULL
     FOR NO KEY UPDATE SKIP LOCKED`,
    [now],
  );
  if (expired.length) await transition(db, expired, "released", { hold_expires_at: null });
  const lapsed = await many<{ bench: string }>(
    db,
    `UPDATE waitlist_entries SET state = 'offer_lapsed' WHERE state = 'offered' AND offer_expires_at <= $1 RETURNING bench`,
    [now],
  );
  await offerFreedBenches(db, now, [...expired, ...lapsed].map((row) => row.bench));
}

/**
 * Offers open benches to the first waitlisted entry of their tier, the benches just freed first,
 * while the tier has a bench to offer (and, for Atelier, the cap allows).
 */
export async function offerFreedBenches(db: Db, now: Date, freed: readonly string[]): Promise<void> {
  for (const tier of ["bench", "atelier"] as const) {
    for (;;) {
      const entry = await one<{ id: string; email: string }>(
        db,
        `SELECT w.id, a.email FROM waitlist_entries w JOIN accounts a ON a.id = w.account_id
         WHERE w.tier = $1 AND w.state = 'waitlisted' ORDER BY w.seq LIMIT 1`,
        [tier],
      );
      if (!entry) break;
      const stock = await currentInventory(db);
      if (tier === "atelier" && stock.atelier.soldOut) break;
      const candidates = [...freed, ...BENCH_LABELS].filter((label) => tierOf(label) === tier && !stock.occupied.has(label));
      const bench = candidates[0];
      if (!bench) break;
      const expiresAt = new Date(now.getTime() + config.offerSeconds * 1000);
      await db.query(`UPDATE waitlist_entries SET state = 'offered', bench = $2, offer_expires_at = $3 WHERE id = $1`, [
        entry.id,
        bench,
        expiresAt,
      ]);
      await enqueueMail(db, `offer:${entry.id}`, {
        to: entry.email,
        subject: "A bench is open for you: sign in to accept",
        body: `Bench ${bench} at Opaline Bench Days is being held for you until ${expiresAt.toUTCString()}.\n\nSign in at /account to accept it. If you do not accept in time, it passes to the next person on the waitlist.`,
      });
    }
  }
}

/** Bench state relative to the viewer, as published by GET /api/benches. */
export function benchState(occupant: Occupant | undefined, viewerId: string | null): string {
  if (!occupant) return "open";
  const mine = viewerId !== null && occupant.account_id === viewerId;
  if (occupant.state === "offered") return mine ? "offered_to_you" : "held";
  if (occupant.state === "held") return mine ? "held_by_you" : "held";
  return mine ? "yours" : "sold";
}

export async function waitlistPosition(db: Queryable, entryId: string): Promise<number> {
  const row = await oneRow<{ position: number }>(
    db,
    `SELECT count(*)::int + 1 AS position FROM waitlist_entries o JOIN waitlist_entries me ON me.id = $1
     WHERE o.tier = me.tier AND o.state = 'waitlisted' AND o.seq < me.seq`,
    [entryId],
  );
  return row.position;
}
