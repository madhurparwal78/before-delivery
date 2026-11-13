import type { Queryable } from '../server/db.js';
import type { RateCardView } from '../shared/types.js';
import { todayUtc } from '../shared/dates.js';

interface ActiveRate {
  kitId: string;
  dayRateCents: number;
  depositCents: number;
  version: number;
  effectiveDate: string;
}

/**
 * The active card is the one with the latest effective date on or before today,
 * the highest version winning a tie.
 */
export async function activeRateCardVersion(client: Queryable): Promise<number> {
  const result = await client.query<{ version: number }>(
    `SELECT version FROM rate_cards
      WHERE effective_date <= $1::date
      ORDER BY effective_date DESC, version DESC
      LIMIT 1`,
    [todayUtc()],
  );
  const version = result.rows[0]?.version;
  if (version === undefined) throw new Error('No rate card is in effect');
  return version;
}

async function ratesForVersion(
  client: Queryable,
  version: number,
): Promise<Map<string, ActiveRate>> {
  const result = await client.query<{
    kit_id: string;
    day_rate_cents: number;
    deposit_cents: number;
    effective_date: string;
  }>(
    `SELECT r.kit_id, r.day_rate_cents, r.deposit_cents, c.effective_date
       FROM rate_card_rates r JOIN rate_cards c ON c.version = r.version
      WHERE r.version = $1`,
    [version],
  );
  return new Map(
    result.rows.map((row) => [
      row.kit_id,
      {
        kitId: row.kit_id,
        dayRateCents: row.day_rate_cents,
        depositCents: row.deposit_cents,
        version,
        effectiveDate: row.effective_date,
      },
    ]),
  );
}

export async function activeRates(client: Queryable): Promise<Map<string, ActiveRate>> {
  return ratesForVersion(client, await activeRateCardVersion(client));
}

export async function rateCardEffectiveDate(
  client: Queryable,
  version: number,
): Promise<string> {
  const result = await client.query<{ effective_date: string }>(
    `SELECT effective_date FROM rate_cards WHERE version = $1`,
    [version],
  );
  const effectiveDate = result.rows[0]?.effective_date;
  if (effectiveDate === undefined) throw new Error(`Rate card v${version} is missing`);
  return effectiveDate;
}

export async function listRateCards(
  client: Queryable,
): Promise<{ activeVersion: number; rateCards: RateCardView[] }> {
  const cards = await client.query<{
    version: number;
    effective_date: string;
    published_at: Date;
  }>(`SELECT version, effective_date, published_at FROM rate_cards ORDER BY version ASC`);
  const rates = await client.query<{
    version: number;
    kit_id: string;
    day_rate_cents: number;
    deposit_cents: number;
  }>(
    `SELECT r.version, r.kit_id, r.day_rate_cents, r.deposit_cents
       FROM rate_card_rates r JOIN kits k ON k.id = r.kit_id
      ORDER BY r.version ASC, k.seq ASC`,
  );
  return {
    activeVersion: await activeRateCardVersion(client),
    rateCards: cards.rows.map((card) => ({
      version: card.version,
      effectiveDate: card.effective_date,
      publishedAt: card.published_at.toISOString(),
      rates: rates.rows
        .filter((rate) => rate.version === card.version)
        .map((rate) => ({
          kitId: rate.kit_id,
          dayRateCents: rate.day_rate_cents,
          depositCents: rate.deposit_cents,
        })),
    })),
  };
}

export async function publishRateCard(
  client: Queryable,
  effectiveDate: string,
  rates: { kitId: string; dayRateCents: number; depositCents: number }[],
): Promise<RateCardView> {
  await client.query('LOCK TABLE rate_cards IN EXCLUSIVE MODE');
  const next = await client.query<{ version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM rate_cards`,
  );
  const version = next.rows[0]?.version;
  if (version === undefined) throw new Error('Could not number the new rate card');
  const inserted = await client.query<{ published_at: Date }>(
    `INSERT INTO rate_cards (version, effective_date) VALUES ($1, $2) RETURNING published_at`,
    [version, effectiveDate],
  );
  const publishedAt = inserted.rows[0]?.published_at;
  if (publishedAt === undefined) throw new Error('Rate card was not inserted');
  for (const rate of rates) {
    await client.query(
      `INSERT INTO rate_card_rates (version, kit_id, day_rate_cents, deposit_cents)
       VALUES ($1, $2, $3, $4)`,
      [version, rate.kitId, rate.dayRateCents, rate.depositCents],
    );
  }
  const ordered = await client.query<{
    kit_id: string;
    day_rate_cents: number;
    deposit_cents: number;
  }>(
    `SELECT r.kit_id, r.day_rate_cents, r.deposit_cents
       FROM rate_card_rates r JOIN kits k ON k.id = r.kit_id
      WHERE r.version = $1 ORDER BY k.seq ASC`,
    [version],
  );
  return {
    version,
    effectiveDate,
    publishedAt: publishedAt.toISOString(),
    rates: ordered.rows.map((row) => ({
      kitId: row.kit_id,
      dayRateCents: row.day_rate_cents,
      depositCents: row.deposit_cents,
    })),
  };
}
