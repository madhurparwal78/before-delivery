import pg from "pg";
import { query } from "./db.js";
import { ATELIER_CAP, SEATS_TOTAL, type Config } from "./config.js";
import type { ReservationState, Tier } from "./domain.js";
import { venueDate, depositsOpen, nowIso } from "./time.js";

export type BenchViewState = "open" | "held" | "held_by_you" | "offered_to_you" | "sold" | "yours";

export interface BenchView {
  label: string;
  row: string;
  number: number;
  tier: Tier;
  state: BenchViewState;
}

export interface LedgerCounts {
  seats_total: number;
  seats_remaining: number;
  held: number;
  sold: number;
  tiers: {
    bench: { remaining: number };
    atelier: { remaining: number; cap: number; active: number; sold_out: boolean };
  };
}

interface Occupied {
  bench: string;
  kind: "offer" | "hold" | "sold";
  buyerId: string | null;
  offerAccountId: string | null;
  attendeeEmail: string | null;
  attendeeAccepted: boolean;
}

const ACTIVE_SQL = "('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')";

/**
 * The one ledger computation. The bench map, GET /api/benches, the desks, the
 * reserve bar and every mutation response all report its result.
 */
export async function computeLedger(): Promise<{ counts: LedgerCounts; occupied: Map<string, Occupied> }> {
  const { rows: benchRows } = await query<{ label: string; row: string }>("SELECT label, row FROM benches ORDER BY row, number");
  const { rows: holds } = await query<{
    bench: string; row: string; state: ReservationState;
    buyer_id: string; attendee_email: string | null; attendee_accepted: boolean;
    payment_in_flight: boolean; payment_pending: string | null;
    hold_live: boolean;
  }>(
    `SELECT r.bench, b.row, r.state, r.buyer_id, r.attendee_email, r.attendee_accepted,
            r.payment_in_flight, r.payment_pending,
            (r.hold_expires_at IS NOT NULL AND r.hold_expires_at > now()) AS hold_live
     FROM reservations r JOIN benches b ON b.label = r.bench
     WHERE r.state IN ${ACTIVE_SQL}`
  );
  const { rows: offers } = await query<{ bench: string; row: string; account_id: string }>(
    `SELECT w.bench, b.row, w.account_id
     FROM waitlist w JOIN benches b ON b.label = w.bench
     WHERE w.state = 'offered' AND w.offer_expires_at > now()`
  );

  const occupied = new Map<string, Occupied>();
  let held = 0;
  let sold = 0;
  let atelierActive = 0;

  for (const o of offers) {
    if (occupied.has(o.bench)) continue;
    occupied.set(o.bench, {
      bench: o.bench, kind: "offer",
      buyerId: null, offerAccountId: o.account_id,
      attendeeEmail: null, attendeeAccepted: false,
    });
    held += 1;
    if (o.row === "A" || o.row === "B") atelierActive += 1;
  }

  for (const r of holds) {
    if (occupied.has(r.bench)) continue;
    const live = r.state === "held" ? (r.hold_live || r.payment_in_flight || r.payment_pending !== null) : true;
    if (!live) continue;
    const soldState = r.state !== "held";
    occupied.set(r.bench, {
      bench: r.bench,
      kind: soldState ? "sold" : "hold",
      buyerId: r.buyer_id,
      offerAccountId: null,
      attendeeEmail: r.attendee_email,
      attendeeAccepted: r.attendee_accepted,
    });
    if (soldState) sold += 1;
    else held += 1;
    if (r.row === "A" || r.row === "B") atelierActive += 1;
  }

  const openBenchTier = benchRows.filter((b) => (b.row === "C" || b.row === "D") && !occupied.has(b.label)).length;
  const openAtelier = benchRows.filter((b) => (b.row === "A" || b.row === "B") && !occupied.has(b.label)).length;
  const atelierRemaining = Math.min(openAtelier, Math.max(0, ATELIER_CAP - atelierActive));

  return {
    counts: {
      seats_total: SEATS_TOTAL,
      seats_remaining: SEATS_TOTAL - held - sold,
      held,
      sold,
      tiers: {
        bench: { remaining: openBenchTier },
        atelier: {
          remaining: atelierRemaining,
          cap: ATELIER_CAP,
          active: atelierActive,
          sold_out: atelierRemaining <= 0,
        },
      },
    },
    occupied,
  };
}

export async function benchViewsFor(viewerAccountId: string | null, viewerEmail: string | null): Promise<{ counts: LedgerCounts; benches: BenchView[] }> {
  const { counts, occupied } = await computeLedger();
  const { rows: benchRows } = await query<{ label: string; row: string; number: number }>("SELECT label, row, number FROM benches ORDER BY row, number");
  const mineSold = new Set<string>();
  const myHolds = new Set<string>();
  const myOffers = new Set<string>();
  if (viewerAccountId) {
    for (const [bench, occ] of occupied) {
      if (occ.kind === "hold" && occ.buyerId === viewerAccountId) myHolds.add(bench);
      if (occ.kind === "offer" && occ.offerAccountId === viewerAccountId) myOffers.add(bench);
      if (occ.kind === "sold" && occ.buyerId === viewerAccountId) mineSold.add(bench);
      if (occ.kind === "sold" && viewerEmail && occ.attendeeAccepted && occ.attendeeEmail === viewerEmail) mineSold.add(bench);
    }
  }
  const benches: BenchView[] = benchRows.map((b) => {
    const tier: Tier = b.row === "A" || b.row === "B" ? "atelier" : "bench";
    const occ = occupied.get(b.label);
    let state: BenchViewState = "open";
    if (occ) {
      if (occ.kind === "offer") state = myOffers.has(b.label) ? "offered_to_you" : "held";
      else if (occ.kind === "hold") state = myHolds.has(b.label) ? "held_by_you" : "held";
      else state = mineSold.has(b.label) ? "yours" : "sold";
    }
    return { label: b.label, row: b.row, number: b.number, tier, state };
  });
  return { counts, benches };
}

export async function deskInventory(): Promise<{
  seats_total: number; seats_remaining: number; held: number; sold: number;
  waitlisted: { bench: number; atelier: number };
  atelier: { active: number; cap: number; remaining: number; sold_out: boolean };
}> {
  const { counts } = await computeLedger();
  const { rows } = await query<{ tier: string; count: number }>(
    "SELECT tier, count(*)::int AS count FROM waitlist WHERE state = 'waitlisted' GROUP BY tier"
  );
  const waitlisted = { bench: 0, atelier: 0 };
  for (const r of rows) {
    if (r.tier === "bench") waitlisted.bench = Number(r.count);
    else waitlisted.atelier = Number(r.count);
  }
  return {
    seats_total: counts.seats_total,
    seats_remaining: counts.seats_remaining,
    held: counts.held,
    sold: counts.sold,
    waitlisted,
    atelier: { ...counts.tiers.atelier },
  };
}

export type PoolClient = pg.PoolClient;

/** The envelope every bench-state response shares. */
export function ledgerPayload(cfg: Config, counts: LedgerCounts, benches: BenchView[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    server_time: nowIso(),
    venue_date: venueDate(cfg.benchDaysNow),
    deposits_open: depositsOpen(venueDate(cfg.benchDaysNow)),
    seats_total: counts.seats_total,
    seats_remaining: counts.seats_remaining,
    held: counts.held,
    sold: counts.sold,
    tiers: counts.tiers,
    benches,
    ...extra,
  };
}
