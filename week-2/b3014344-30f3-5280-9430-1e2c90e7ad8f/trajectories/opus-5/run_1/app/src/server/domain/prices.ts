import { randomUUID } from "node:crypto";
import { query, queryOne } from "../db.js";
import { type Currency, type Money, money } from "../../shared/money.js";
import { type PlanId } from "../../shared/plans.js";

export interface PriceRow {
  id: string;
  plan: PlanId;
  currency: Currency;
  amount: Money;
  effectiveAt: Date;
}

interface PriceRecord {
  id: string;
  plan: string;
  currency: string;
  amount_minor: string;
  effective_at: Date;
}

export const SEED_PRICE_EFFECTIVE_AT = "2026-01-01T00:00:00-03:00";

export const SEED_PRICES: ReadonlyArray<{ plan: PlanId; currency: Currency; minor: bigint }> = [
  { plan: "launch-page", currency: "USD", minor: 184_999n },
  { plan: "launch-page", currency: "ARS", minor: 23_333_333n },
  { plan: "studio-site", currency: "USD", minor: 499_999n },
  { plan: "studio-site", currency: "ARS", minor: 58_765_432n },
  { plan: "care-lite", currency: "USD", minor: 14_900n },
  { plan: "care-lite", currency: "ARS", minor: 18_999_999n },
  { plan: "care-plus", currency: "USD", minor: 34_900n },
  { plan: "care-plus", currency: "ARS", minor: 44_999_999n },
];

function toPriceRow(record: PriceRecord): PriceRow {
  return {
    id: record.id,
    plan: record.plan as PlanId,
    currency: record.currency as Currency,
    amount: money(record.currency as Currency, BigInt(record.amount_minor)),
    effectiveAt: record.effective_at,
  };
}

/** The price row with the latest effective instant at or before the given instant. */
export async function priceInEffect(plan: PlanId, currency: Currency, at: Date): Promise<PriceRow | null> {
  const record = await queryOne<PriceRecord>(
    `select id, plan, currency, amount_minor, effective_at
       from prices
      where plan = $1 and currency = $2 and effective_at <= $3
      order by effective_at desc, created_at desc
      limit 1`,
    [plan, currency, at.toISOString()],
  );
  return record ? toPriceRow(record) : null;
}

export async function allPriceRows(): Promise<PriceRow[]> {
  const records = await query<PriceRecord>(
    `select id, plan, currency, amount_minor, effective_at from prices order by effective_at asc, created_at asc`,
  );
  return records.map(toPriceRow);
}

export async function insertPriceRow(input: {
  plan: PlanId;
  currency: Currency;
  amount: Money;
  effectiveAt: Date;
}): Promise<PriceRow> {
  const id = randomUUID();
  await query(
    `insert into prices (id, plan, currency, amount_minor, effective_at) values ($1, $2, $3, $4, $5)`,
    [id, input.plan, input.currency, input.amount.minor.toString(), input.effectiveAt.toISOString()],
  );
  return { id, plan: input.plan, currency: input.currency, amount: input.amount, effectiveAt: input.effectiveAt };
}

export async function seedPrices(): Promise<void> {
  const effectiveAt = new Date(SEED_PRICE_EFFECTIVE_AT);
  for (const seed of SEED_PRICES) {
    const existing = await queryOne<{ id: string }>(
      `select id from prices where plan = $1 and currency = $2 and effective_at = $3`,
      [seed.plan, seed.currency, effectiveAt.toISOString()],
    );
    if (existing) continue;
    await insertPriceRow({
      plan: seed.plan,
      currency: seed.currency,
      amount: money(seed.currency, seed.minor),
      effectiveAt,
    });
  }
}
