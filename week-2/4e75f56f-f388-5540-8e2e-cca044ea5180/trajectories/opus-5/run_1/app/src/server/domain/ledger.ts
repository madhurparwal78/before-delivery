import {
  ATELIER_CAP,
  BENCH_LABELS,
  benchNumber,
  benchRow,
  SEATS_TOTAL,
  tierOfBench,
  type Tier,
} from '../../shared/benches.js';
import type { Queryable } from '../db/pool.js';
import { SOLD_STATES } from './reservationState.js';

export type BenchState = 'open' | 'held' | 'held_by_you' | 'offered_to_you' | 'sold' | 'yours';

export interface BenchView {
  readonly label: string;
  readonly row: string;
  readonly number: number;
  readonly tier: Tier;
  readonly state: BenchState;
}

export interface Ledger {
  readonly seatsTotal: number;
  readonly seatsRemaining: number;
  readonly held: number;
  readonly sold: number;
  readonly benches: readonly BenchView[];
  readonly tiers: {
    readonly bench: { readonly remaining: number };
    readonly atelier: {
      readonly remaining: number;
      readonly cap: number;
      readonly active: number;
      readonly soldOut: boolean;
    };
  };
  readonly waitlisted: { readonly bench: number; readonly atelier: number };
}

interface Occupant {
  bench: string;
  tier: Tier;
  owner: string;
  attendee: string | null;
}

interface SnapshotRow {
  holds: Occupant[];
  sold: Occupant[];
  offers: Occupant[];
  waitlisted_bench: string;
  waitlisted_atelier: string;
}

const SNAPSHOT_SQL = `
  with live_holds as (
    select bench, tier, buyer_id, attendee_account_id
    from reservations
    where state = 'held'
      and (hold_expires_at > now() or payment_in_flight is not null or payment_pending is not null)
  ),
  sold_seats as (
    select bench, tier, buyer_id, attendee_account_id
    from reservations
    where state = any($1::text[])
  ),
  live_offers as (
    select bench, tier, account_id
    from offers
    where state = 'offered' and expires_at > now()
  )
  select
    coalesce((select json_agg(json_build_object(
        'bench', bench, 'tier', tier, 'owner', buyer_id, 'attendee', attendee_account_id))
      from live_holds), '[]'::json) as holds,
    coalesce((select json_agg(json_build_object(
        'bench', bench, 'tier', tier, 'owner', buyer_id, 'attendee', attendee_account_id))
      from sold_seats), '[]'::json) as sold,
    coalesce((select json_agg(json_build_object(
        'bench', bench, 'tier', tier, 'owner', account_id, 'attendee', null))
      from live_offers), '[]'::json) as offers,
    (select count(*) from waitlist_entries where tier = 'bench' and state = 'waitlisted') as waitlisted_bench,
    (select count(*) from waitlist_entries where tier = 'atelier' and state = 'waitlisted') as waitlisted_atelier
`;

/**
 * The one ledger computation. Every seat count, bench state and Atelier cap
 * decision on every surface comes from here.
 */
export async function computeLedger(client: Queryable, viewerId: string | null): Promise<Ledger> {
  const result = await client.query<SnapshotRow>(SNAPSHOT_SQL, [SOLD_STATES]);
  const snapshot = result.rows[0];
  if (snapshot === undefined) throw new Error('ledger snapshot missing');

  const states = new Map<string, BenchState>();
  const occupied = new Set<string>();

  for (const seat of snapshot.sold) {
    occupied.add(seat.bench);
    const yours = viewerId !== null && (seat.owner === viewerId || seat.attendee === viewerId);
    states.set(seat.bench, yours ? 'yours' : 'sold');
  }
  for (const seat of snapshot.holds) {
    occupied.add(seat.bench);
    states.set(seat.bench, viewerId !== null && seat.owner === viewerId ? 'held_by_you' : 'held');
  }
  for (const seat of snapshot.offers) {
    occupied.add(seat.bench);
    states.set(seat.bench, viewerId !== null && seat.owner === viewerId ? 'offered_to_you' : 'held');
  }

  const held = snapshot.holds.length + snapshot.offers.length;
  const sold = snapshot.sold.length;
  const seatsRemaining = SEATS_TOTAL - held - sold;

  const atelierActive = [...snapshot.holds, ...snapshot.sold, ...snapshot.offers].filter(
    (seat) => seat.tier === 'atelier',
  ).length;

  const openByTier: Record<Tier, number> = { bench: 0, atelier: 0 };
  const benches: BenchView[] = BENCH_LABELS.map((label) => {
    const tier = tierOfBench(label);
    const state = states.get(label) ?? 'open';
    if (state === 'open') openByTier[tier] += 1;
    return { label, row: benchRow(label), number: benchNumber(label), tier, state };
  });

  return {
    seatsTotal: SEATS_TOTAL,
    seatsRemaining,
    held,
    sold,
    benches,
    tiers: {
      bench: { remaining: openByTier.bench },
      atelier: {
        remaining: Math.min(openByTier.atelier, Math.max(0, ATELIER_CAP - atelierActive)),
        cap: ATELIER_CAP,
        active: atelierActive,
        soldOut: atelierActive >= ATELIER_CAP,
      },
    },
    waitlisted: {
      bench: Number.parseInt(snapshot.waitlisted_bench, 10),
      atelier: Number.parseInt(snapshot.waitlisted_atelier, 10),
    },
  };
}

export function openBenchesOfTier(ledger: Ledger, tier: Tier): readonly BenchView[] {
  if (tier === 'atelier' && ledger.tiers.atelier.soldOut) return [];
  return ledger.benches.filter((bench) => bench.tier === tier && bench.state === 'open');
}

/** True when the tier has a bench a buyer could hold right now. */
export function tierHasHoldableBench(ledger: Ledger, tier: Tier): boolean {
  return openBenchesOfTier(ledger, tier).length > 0;
}
