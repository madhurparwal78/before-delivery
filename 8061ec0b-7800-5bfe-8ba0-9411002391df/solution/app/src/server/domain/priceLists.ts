// Publishing and withdrawing price list versions. Versions are never edited or deleted; withdrawal only marks
// a version that has not taken effect yet.

import { isCalendarDate } from "../../shared/storeTime.js";
import { INSTRUMENT_TYPES, type InstrumentType } from "../../shared/vocabulary.js";
import { nowSecond, storeToday } from "../clock.js";
import { pool, query, transaction } from "../db/pool.js";
import { ApiError, notFound, validationFailed } from "../http/errors.js";
import { fieldOf, trimmedText, wholeNumber } from "../http/fields.js";
import { priceListInForce } from "../../shared/priceLists.js";
import { loadPriceLists, priceListBody, type PriceListRow } from "./terms.js";

export async function currentPriceList(on: string | null): Promise<unknown> {
  const date = on ?? storeToday();
  if (!isCalendarDate(date)) throw validationFailed({ on: "Use a date in YYYY-MM-DD form." });
  const version = priceListInForce(await loadPriceLists(pool), date);
  if (version === undefined) throw notFound("not_found", "No price list is in force on that date.");
  return { price_list: version };
}

export async function listPriceLists(): Promise<unknown> {
  return { price_lists: await loadPriceLists(pool) };
}

const MONEY_RULES = {
  base_rent_cents: [100, 100_000, "Enter a monthly rent from $1.00 to $1,000.00."],
  waiver_cents: [0, 10_000, "Enter a waiver from $0.00 to $100.00."],
  purchase_price_cents: [1_000, 1_000_000, "Enter a purchase price from $10.00 to $10,000.00, at least the monthly rent."],
} as const;

interface ValidTier { from_month: number; to_month: number | null; percent: number; name: string }

/** Every rule of a new version, every invalid field reported at once under its published key. */
function validate(body: unknown, today: string): { fields: Record<string, string>; version: {
  effective_date: string; tax_rate_bp: number; items: Record<InstrumentType, Record<keyof typeof MONEY_RULES, number>>;
  tiers: ValidTier[] } | null } {
  const fields: Record<string, string> = {};
  const effective = fieldOf(body, "effective_date");
  if (typeof effective !== "string" || !isCalendarDate(effective) || effective < today) {
    fields.effective_date = "Use a date from today on, as YYYY-MM-DD.";
  }
  const tax = wholeNumber(fieldOf(body, "tax_rate_bp"), 0, 2_000);
  if (tax === null) fields.tax_rate_bp = "Enter a rate from 0.00% to 20.00%.";
  const rawItems = fieldOf(body, "items");
  const items = Array.isArray(rawItems) ? rawItems : [];
  const byType = new Map(items.map((item) => [fieldOf(item, "instrument_type"), item]));
  const complete = items.length === INSTRUMENT_TYPES.length && INSTRUMENT_TYPES.every((t) => byType.has(t));
  if (!complete) fields.items = "Give one price for each of the five instruments.";
  const prices = {} as Record<InstrumentType, Record<keyof typeof MONEY_RULES, number>>;
  for (const type of INSTRUMENT_TYPES) {
    const item = byType.get(type);
    if (item === undefined) continue;
    const amounts = { base_rent_cents: 0, waiver_cents: 0, purchase_price_cents: 0 };
    for (const key of Object.keys(MONEY_RULES) as (keyof typeof MONEY_RULES)[]) {
      const [min, max, message] = MONEY_RULES[key];
      const value = wholeNumber(fieldOf(item, key), min, max);
      if (value === null) fields[`items.${type}.${key}`] = message;
      else amounts[key] = value;
    }
    if (!(`items.${type}.purchase_price_cents` in fields) && amounts.purchase_price_cents < amounts.base_rent_cents) {
      fields[`items.${type}.purchase_price_cents`] = MONEY_RULES.purchase_price_cents[2];
    }
    prices[type] = amounts;
  }
  const rawTiers = fieldOf(body, "tiers");
  const tiers = Array.isArray(rawTiers) ? rawTiers : [];
  if (tiers.length < 1 || tiers.length > 6) fields.tiers = "Add between 1 and 6 tiers.";
  const valid: ValidTier[] = [];
  tiers.forEach((tier, i) => {
    const from = wholeNumber(fieldOf(tier, "from_month"), 0, 100_000);
    const rawTo = fieldOf(tier, "to_month");
    const last = i === tiers.length - 1;
    const previousTo = i === 0 ? -1 : fieldOf(tiers[i - 1], "to_month");
    const expectedFrom = typeof previousTo === "number" ? previousTo + 1 : null;
    if (from === null || from !== (i === 0 ? 0 : expectedFrom)) {
      fields[`tiers.${i}.from_month`] = i === 0 ? "The first tier starts at month 0."
        : "Start this tier the month after the previous tier ends.";
    }
    const to = rawTo === null ? null : wholeNumber(rawTo, 0, 100_000);
    if (last ? rawTo !== null : to === null || from === null || to < from) {
      fields[`tiers.${i}.to_month`] = "End this tier at or after its start; only the last tier is open-ended.";
    }
    const percent = wholeNumber(fieldOf(tier, "percent"), 0, 90);
    if (percent === null) fields[`tiers.${i}.percent`] = "Enter a whole percent from 0 to 90.";
    const name = fieldOf(tier, "name");
    const named = typeof name === "string" && trimmedText(name, 1, 30) !== null ? name.trim() : null;
    if (named === null) fields[`tiers.${i}.name`] = "Name this tier in 1 to 30 characters.";
    if (from !== null && percent !== null && named !== null) valid.push({ from_month: from, to_month: to, percent, name: named });
  });
  if (Object.keys(fields).length > 0 || typeof effective !== "string" || tax === null) return { fields, version: null };
  return { fields, version: { effective_date: effective, tax_rate_bp: tax, items: prices, tiers: valid } };
}

export async function publishPriceList(body: unknown): Promise<unknown> {
  const { fields, version } = validate(body, storeToday());
  if (version === null) throw validationFailed(fields);
  return transaction(async (db) => {
    const [{ next }] = await query<{ next: number }>(db, "SELECT nextval('price_list_number') AS next");
    const id = `PL-${version.effective_date.slice(0, 4)}-${String(next).padStart(2, "0")}`;
    const items = INSTRUMENT_TYPES.map((instrument_type) => ({ instrument_type, ...version.items[instrument_type] }));
    const [row] = await query<PriceListRow>(db, `INSERT INTO price_lists
      (id, effective_date, created_at, tax_rate_bp, items, tiers) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, effective_date, created_at, withdrawn_at, tax_rate_bp, items, tiers`,
    [id, version.effective_date, nowSecond(), version.tax_rate_bp, JSON.stringify(items), JSON.stringify(version.tiers)]);
    return { price_list: priceListBody(row) };
  });
}

export async function withdrawPriceList(id: string): Promise<unknown> {
  return transaction(async (db) => {
    const [found] = await query<{ effective_date: string; withdrawn_at: Date | null }>(db,
      "SELECT effective_date, withdrawn_at FROM price_lists WHERE id = $1 FOR UPDATE", [id]);
    if (found === undefined) throw notFound();
    if (found.withdrawn_at !== null) throw new ApiError(409, "price_list_withdrawn", `${id} was already withdrawn.`);
    if (found.effective_date <= storeToday()) {
      throw new ApiError(409, "price_list_in_force", `${id} is already in force and can't be withdrawn.`);
    }
    const [row] = await query<PriceListRow>(db, `UPDATE price_lists SET withdrawn_at = $2
      WHERE id = $1 RETURNING id, effective_date, created_at, withdrawn_at, tax_rate_bp, items, tiers`, [id, nowSecond()]);
    return { price_list: priceListBody(row) };
  });
}
