import type { PoolClient } from "pg";
import type { InstrumentType, Tier, PriceListStanding } from "../../shared/domain.js";
import type { AppConfig } from "../config.js";

export interface PriceListRow {
  id: string;
  effective_date: string;
  tax_rate_bp: number;
  items: PriceItemRow[];
  tiers: TierRow[];
  created_at: Date;
  withdrawn_at: Date | null;
}

export interface PriceItemRow {
  instrument_type: InstrumentType;
  base_rent_cents: number;
  waiver_cents: number;
  purchase_price_cents: number;
}

export interface TierRow {
  from_month: number;
  to_month: number | null;
  percent: number;
  name: string;
}

export function tierLabel(tier: TierRow): string {
  return `${tier.name}, ${tier.percent}% off remaining`;
}

export function toTier(t: TierRow): Tier {
  return { ...t, label: tierLabel(t) };
}

export async function priceListInForceOn(client: PoolClient, date: string): Promise<PriceListRow | null> {
  // The version in force on D: not withdrawn, latest effective_date on or
  // before D; ties broken by the one created most recently.
  const rows = await client.query<Record<string, unknown>>(
    `SELECT * FROM price_lists
      WHERE withdrawn_at IS NULL AND effective_date <= $1
      ORDER BY effective_date DESC, created_at DESC
      LIMIT 1`,
    [date]
  );
  if (rows.rows.length === 0) return null;
  return deserialize(rows.rows[0]);
}

export async function priceListById(client: PoolClient, id: string): Promise<PriceListRow | null> {
  const rows = await client.query<Record<string, unknown>>("SELECT * FROM price_lists WHERE id = $1", [id]);
  if (rows.rows.length === 0) return null;
  return deserialize(rows.rows[0]);
}

export async function allPriceLists(client: PoolClient): Promise<PriceListRow[]> {
  const rows = await client.query<Record<string, unknown>>(
    "SELECT * FROM price_lists ORDER BY effective_date DESC, created_at DESC"
  );
  return rows.rows.map(deserialize);
}

export function deserialize(row: Record<string, unknown>): PriceListRow {
  return {
    id: row.id as string,
    effective_date: row.effective_date as string,
    tax_rate_bp: Number(row.tax_rate_bp),
    items: row.items as PriceItemRow[],
    tiers: row.tiers as TierRow[],
    created_at: new Date(row.created_at as string),
    withdrawn_at: row.withdrawn_at ? new Date(row.withdrawn_at as string) : null,
  };
}

export function priceListStanding(list: PriceListRow, today: string, inForceId: string | null): PriceListStanding {
  if (list.withdrawn_at) return "Withdrawn";
  if (inForceId !== null && list.id === inForceId) return "In force";
  if (list.effective_date > today) return "Scheduled";
  return "Superseded";
}

export function itemFor(list: PriceListRow, type: InstrumentType): PriceItemRow {
  const item = list.items.find((i) => i.instrument_type === type);
  if (!item) throw new Error(`Price list ${list.id} has no ${type} item`);
  return item;
}

export function termMonthsFor(item: PriceItemRow): number {
  return Math.ceil(item.purchase_price_cents / item.base_rent_cents);
}

export function tierForMonth(tiers: TierRow[], month: number): TierRow {
  const tier = tiers.find(
    (t) => month >= t.from_month && (t.to_month === null || month <= t.to_month)
  );
  if (!tier) throw new Error(`No tier contains month ${month}`);
  return tier;
}

// The sales tax rate in force on a date. Never follows a contract's bound
// version, except that a withdrawn version is never in force anywhere.
export async function taxRateOnDate(client: PoolClient, date: string): Promise<number | null> {
  const list = await priceListInForceOn(client, date);
  return list ? list.tax_rate_bp : null;
}

export function nextPriceListId(): string {
  const year = new Date().getUTCFullYear();
  return `PL-${year}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export interface ValidationResult {
  ok: boolean;
  fields: Record<string, string>;
}

export function validateNewPriceList(
  input: {
    effective_date: string | null;
    tax_rate_bp: number | null;
    items: { instrument_type: InstrumentType; base_rent_cents: number | null; waiver_cents: number | null; purchase_price_cents: number | null }[];
    tiers: { from_month: number | null; to_month: number | null; percent: number | null; name: string | null }[];
  },
  today: string
): ValidationResult {
  const fields: Record<string, string> = {};
  if (input.effective_date === null || !/^\d{4}-\d{2}-\d{2}$/.test(input.effective_date) || input.effective_date < today) {
    fields.effective_date = "Use a date from today on, as YYYY-MM-DD.";
  }
  if (input.tax_rate_bp === null || !Number.isInteger(input.tax_rate_bp) || input.tax_rate_bp < 0 || input.tax_rate_bp > 2000) {
    fields.tax_rate_bp = "Enter a rate from 0.00% to 20.00%.";
  }
  if (input.items.length !== 5) {
    fields.items = "Give one price for each of the five instruments.";
  }
  for (const item of input.items) {
    const t = item.instrument_type;
    if (item.base_rent_cents === null || !Number.isInteger(item.base_rent_cents) || item.base_rent_cents < 100 || item.base_rent_cents > 100000) {
      fields[`items.${t}.base_rent_cents`] = "Enter a monthly rent from $1.00 to $1,000.00.";
    }
    if (item.waiver_cents === null || !Number.isInteger(item.waiver_cents) || item.waiver_cents < 0 || item.waiver_cents > 10000) {
      fields[`items.${t}.waiver_cents`] = "Enter a waiver from $0.00 to $100.00.";
    }
    if (
      item.purchase_price_cents === null || !Number.isInteger(item.purchase_price_cents) ||
      item.purchase_price_cents < 1000 || item.purchase_price_cents > 1000000 ||
      (item.base_rent_cents !== null && item.purchase_price_cents < item.base_rent_cents)
    ) {
      fields[`items.${t}.purchase_price_cents`] = "Enter a purchase price from $10.00 to $10,000.00, at least the monthly rent.";
    }
  }
  if (input.tiers.length < 1 || input.tiers.length > 6) {
    fields.tiers = "Add between 1 and 6 tiers.";
  }
  input.tiers.forEach((tier, i) => {
    if (tier.name === null || tier.name.trim().length < 1 || tier.name.trim().length > 30) {
      fields[`tiers.${i}.name`] = "Name this tier in 1 to 30 characters.";
    }
    const expectedFrom = i === 0 ? 0 : input.tiers[i - 1].to_month !== null ? input.tiers[i - 1].to_month! + 1 : null;
    if (tier.from_month === null || !Number.isInteger(tier.from_month) || tier.from_month < 0 || (expectedFrom !== null && tier.from_month !== expectedFrom)) {
      fields[`tiers.${i}.from_month`] = i === 0 ? "The first tier starts at month 0." : "Start this tier the month after the previous tier ends.";
    }
    if (tier.to_month !== null && (!Number.isInteger(tier.to_month) || (tier.from_month !== null && tier.to_month < tier.from_month))) {
      fields[`tiers.${i}.to_month`] = "End this tier at or after its start; only the last tier is open-ended.";
    }
    if (tier.percent === null || !Number.isInteger(tier.percent) || tier.percent < 0 || tier.percent > 90) {
      fields[`tiers.${i}.percent`] = "Enter a whole percent from 0 to 90.";
    }
    if (i < input.tiers.length - 1 && tier.to_month === null) {
      fields[`tiers.${i}.to_month`] = "End this tier at or after its start; only the last tier is open-ended.";
    }
  });
  return { ok: Object.keys(fields).length === 0, fields };
}

export function priceListConfig(): Pick<AppConfig, never> {
  return {};
}
