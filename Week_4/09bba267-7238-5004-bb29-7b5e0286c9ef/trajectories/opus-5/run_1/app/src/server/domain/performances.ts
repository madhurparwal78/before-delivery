import type { OwnerTier, Performance, Tier } from '../../shared/api';
import { HALL_SEATS } from '../../shared/hall';
import { seatFeeCents } from '../../shared/money';
import { formatVenueStart, toIsoSeconds } from '../../shared/venueTime';
import { type Db, rows } from '../db';
import { CHANGES_OPEN_SQL, EFFECTIVE_SEAT_STATE_SQL, SALES_OPEN_SQL } from './rules';

interface PerformanceRow {
  id: string;
  title: string;
  starts_at: Date;
  sales_open: boolean;
  changes_open: boolean;
}

interface TierRow {
  performance_id: string;
  tier_id: string;
  name: string;
  face_cents: number;
  on_sale: string;
  held: string;
  sold: string;
  offered: string;
  waitlist_length: string;
}

async function tierRows(db: Db, performanceId: string | null): Promise<TierRow[]> {
  return rows<TierRow>(
    db,
    `select t.performance_id, t.tier_id, t.name, t.face_cents,
            count(s.seat_id) filter (where ${EFFECTIVE_SEAT_STATE_SQL} = 'on_sale') as on_sale,
            count(s.seat_id) filter (where ${EFFECTIVE_SEAT_STATE_SQL} = 'held') as held,
            count(s.seat_id) filter (where ${EFFECTIVE_SEAT_STATE_SQL} = 'sold') as sold,
            count(s.seat_id) filter (where ${EFFECTIVE_SEAT_STATE_SQL} = 'offered') as offered,
            (select count(*) from waitlist_entries w
              where w.performance_id = t.performance_id and w.tier_id = t.tier_id and w.status = 'waiting')
              as waitlist_length
     from tiers t
     left join seats s on s.performance_id = t.performance_id and s.tier_id = t.tier_id
     where ($1::text is null or t.performance_id = $1)
     group by t.performance_id, t.tier_id, t.name, t.face_cents, t.sort_order
     order by t.performance_id, t.sort_order`,
    [performanceId],
  );
}

function toTier(row: TierRow): OwnerTier {
  return {
    id: row.tier_id,
    name: row.name,
    faceCents: row.face_cents,
    seatFeeCents: seatFeeCents(row.face_cents),
    remaining: Number(row.on_sale),
    waitlistLength: Number(row.waitlist_length),
    onSale: Number(row.on_sale),
    held: Number(row.held),
    sold: Number(row.sold),
    offered: Number(row.offered),
  };
}

function publicTier(tier: OwnerTier): Tier {
  const { id, name, faceCents, seatFeeCents: fee, remaining, waitlistLength } = tier;
  return { id, name, faceCents, seatFeeCents: fee, remaining, waitlistLength };
}

function toPerformance(row: PerformanceRow, tiers: OwnerTier[]): Performance<OwnerTier> {
  return {
    id: row.id,
    title: row.title,
    startsAt: toIsoSeconds(row.starts_at),
    startsAtVenue: formatVenueStart(row.starts_at),
    salesOpen: row.sales_open,
    changesOpen: row.changes_open,
    tiers,
  };
}

export function withPublicTiers(performance: Performance<OwnerTier>): Performance {
  return { ...performance, tiers: performance.tiers.map(publicTier) };
}

export async function loadPerformances(db: Db, performanceId: string | null): Promise<Performance<OwnerTier>[]> {
  const performances = await rows<PerformanceRow>(
    db,
    `select p.id, p.title, p.starts_at, ${SALES_OPEN_SQL} as sales_open, ${CHANGES_OPEN_SQL} as changes_open
     from performances p
     where ($1::text is null or p.id = $1)
     order by p.starts_at, p.id`,
    [performanceId],
  );
  const tiers = await tierRows(db, performanceId);
  return performances.map((performance) =>
    toPerformance(performance, tiers.filter((tier) => tier.performance_id === performance.id).map(toTier)),
  );
}

export interface TierDefinition {
  readonly tierId: string;
  readonly name: string;
  readonly faceCents: number;
  readonly seatIds: readonly string[];
}

export interface PerformanceDefinition {
  readonly id: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly tiers: readonly TierDefinition[];
}

export async function createPerformance(db: Db, definition: PerformanceDefinition): Promise<void> {
  await db.query(`insert into performances (id, title, starts_at) values ($1, $2, $3) on conflict do nothing`, [
    definition.id,
    definition.title,
    definition.startsAt,
  ]);
  for (const [index, tier] of definition.tiers.entries()) {
    await db.query(
      `insert into tiers (performance_id, tier_id, name, face_cents, sort_order)
       values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [definition.id, tier.tierId, tier.name, tier.faceCents, index],
    );
  }
  const tierBySeat = new Map<string, string>();
  for (const tier of definition.tiers) {
    for (const seatId of tier.seatIds) tierBySeat.set(seatId, tier.tierId);
  }
  const seatIds = HALL_SEATS.map((seat) => seat.id);
  const tierIds = seatIds.map((seatId) => tierBySeat.get(seatId) ?? null);
  await db.query(
    `insert into seats (performance_id, seat_id, tier_id, state)
     select $1, seat_id, tier_id, case when tier_id is null then 'not_on_sale' else 'on_sale' end
     from unnest($2::text[], $3::text[]) as seat(seat_id, tier_id)
     on conflict do nothing`,
    [definition.id, seatIds, tierIds],
  );
}
