import { CLAIMING_STATES_SQL } from '../domain/transitions.js';
import type { Db } from './db.js';

export interface TierRow {
  id: string;
  campaign_id: string;
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  ship_domestic: number;
  ship_europe: number;
  ship_rest_of_world: number;
  position: number;
}

export interface TierFields {
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  shipping: { domestic: number; europe: number; rest_of_world: number };
}

const COLUMNS = `id, campaign_id, title, description, price, quantity,
  ship_domestic, ship_europe, ship_rest_of_world, position`;

export async function insertTier(
  db: Db,
  id: string,
  campaignId: string,
  fields: TierFields,
): Promise<TierRow> {
  const result = await db.query<TierRow>(
    `insert into tiers (id, campaign_id, title, description, price, quantity,
       ship_domestic, ship_europe, ship_rest_of_world, position)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
       coalesce((select max(position) + 1 from tiers where campaign_id = $2), 0))
     returning ${COLUMNS}`,
    [
      id,
      campaignId,
      fields.title,
      fields.description,
      fields.price,
      fields.quantity,
      fields.shipping.domestic,
      fields.shipping.europe,
      fields.shipping.rest_of_world,
    ],
  );
  return result.rows[0] as TierRow;
}

export async function updateTier(db: Db, id: string, fields: TierFields): Promise<TierRow> {
  const result = await db.query<TierRow>(
    `update tiers set title = $2, description = $3, price = $4, quantity = $5,
       ship_domestic = $6, ship_europe = $7, ship_rest_of_world = $8
     where id = $1 returning ${COLUMNS}`,
    [
      id,
      fields.title,
      fields.description,
      fields.price,
      fields.quantity,
      fields.shipping.domestic,
      fields.shipping.europe,
      fields.shipping.rest_of_world,
    ],
  );
  return result.rows[0] as TierRow;
}

export async function deleteTier(db: Db, id: string): Promise<void> {
  await db.query('delete from tiers where id = $1', [id]);
}

export async function findTier(db: Db, id: string): Promise<TierRow | null> {
  const result = await db.query<TierRow>(`select ${COLUMNS} from tiers where id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function listTiers(db: Db, campaignId: string): Promise<TierRow[]> {
  const result = await db.query<TierRow>(
    `select ${COLUMNS} from tiers where campaign_id = $1 order by position`,
    [campaignId],
  );
  return result.rows;
}

export async function countTiers(db: Db, campaignId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    'select count(*) as count from tiers where campaign_id = $1',
    [campaignId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** A limited tier's claimed count: its pledges in authorising, authorised, captured or errored. */
export async function claimedCounts(db: Db, campaignId: string): Promise<Map<string, number>> {
  const result = await db.query<{ tier_id: string; claimed: string }>(
    `select tier_id, count(*) as claimed from pledges
     where campaign_id = $1 and state in (${CLAIMING_STATES_SQL})
     group by tier_id`,
    [campaignId],
  );
  return new Map(result.rows.map((row) => [row.tier_id, Number(row.claimed)]));
}

export async function claimedCount(db: Db, tierId: string): Promise<number> {
  const result = await db.query<{ claimed: string }>(
    `select count(*) as claimed from pledges
     where tier_id = $1 and state in (${CLAIMING_STATES_SQL})`,
    [tierId],
  );
  return Number(result.rows[0]?.claimed ?? 0);
}
