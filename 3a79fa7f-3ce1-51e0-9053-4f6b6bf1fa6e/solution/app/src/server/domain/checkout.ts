// Checkout totals (brief: Checkout and orders): the country table, the Canadian province table, the ship-by
// calendar and the breakdown, each decided once here.
import type { Catalog } from "../catalog.ts";
import type { Db } from "../db.ts";
import { ApiError, assertValid, type Fields } from "../errors.ts";
import { now } from "../clock.ts";
import { roundHalfUp } from "../money.ts";
import { wallClock } from "../zones.ts";
import { cartState, type CartLine, type PricedLine } from "./cart.ts";
import { financing, type FinancingTerm } from "./financing.ts";

type Warehouse = "San Juan" | "Madrid";

interface TaxRate {
  name: string;
  rate_pcm: number;
}

interface Country {
  code: string;
  name: string;
  package_shipping_cents: number;
  accessory_shipping_cents: number;
  free_accessory_shipping_from_cents: number | null;
  packed_battery_fee_cents: number;
  standalone_battery_fee_cents: number;
  /** null for Canada, taxed by the province of the postal code. */
  taxes: TaxRate[] | null;
  warehouse: Warehouse;
  transit_business_days: number;
}

export const COUNTRIES: Country[] = [
  { code: "US", name: "United States", package_shipping_cents: 0, accessory_shipping_cents: 1500, free_accessory_shipping_from_cents: 100000, packed_battery_fee_cents: 2500, standalone_battery_fee_cents: 4500, taxes: [{ name: "Sales tax", rate_pcm: 7250 }], warehouse: "San Juan", transit_business_days: 2 },
  { code: "PR", name: "Puerto Rico", package_shipping_cents: 0, accessory_shipping_cents: 1500, free_accessory_shipping_from_cents: 100000, packed_battery_fee_cents: 5500, standalone_battery_fee_cents: 9500, taxes: [{ name: "Sales tax", rate_pcm: 11500 }], warehouse: "San Juan", transit_business_days: 1 },
  { code: "CA", name: "Canada", package_shipping_cents: 39900, accessory_shipping_cents: 3500, free_accessory_shipping_from_cents: null, packed_battery_fee_cents: 3500, standalone_battery_fee_cents: 6500, taxes: null, warehouse: "San Juan", transit_business_days: 4 },
  { code: "DE", name: "Germany", package_shipping_cents: 59900, accessory_shipping_cents: 4500, free_accessory_shipping_from_cents: null, packed_battery_fee_cents: 4500, standalone_battery_fee_cents: 8500, taxes: [{ name: "VAT", rate_pcm: 19000 }], warehouse: "Madrid", transit_business_days: 3 },
  { code: "FR", name: "France", package_shipping_cents: 59900, accessory_shipping_cents: 4500, free_accessory_shipping_from_cents: null, packed_battery_fee_cents: 4500, standalone_battery_fee_cents: 8500, taxes: [{ name: "VAT", rate_pcm: 20000 }], warehouse: "Madrid", transit_business_days: 2 },
  { code: "AU", name: "Australia", package_shipping_cents: 79900, accessory_shipping_cents: 6500, free_accessory_shipping_from_cents: null, packed_battery_fee_cents: 7500, standalone_battery_fee_cents: 12500, taxes: [{ name: "GST", rate_pcm: 10000 }], warehouse: "San Juan", transit_business_days: 6 },
];

const GST = { name: "GST", rate_pcm: 5000 };

/** Canadian tax by the first letter of the postal code. */
export const PROVINCES: { letters: string; name: string; taxes: TaxRate[] }[] = [
  { letters: "ACE", name: "Newfoundland and Labrador, Prince Edward Island, New Brunswick", taxes: [{ name: "HST", rate_pcm: 15000 }] },
  { letters: "B", name: "Nova Scotia", taxes: [{ name: "HST", rate_pcm: 14000 }] },
  { letters: "KLMNP", name: "Ontario", taxes: [{ name: "HST", rate_pcm: 13000 }] },
  { letters: "GHJ", name: "Quebec", taxes: [GST, { name: "QST", rate_pcm: 9975 }] },
  { letters: "RV", name: "Manitoba, British Columbia", taxes: [GST, { name: "PST", rate_pcm: 7000 }] },
  { letters: "S", name: "Saskatchewan", taxes: [GST, { name: "PST", rate_pcm: 6000 }] },
  { letters: "TXY", name: "Alberta, Northwest Territories and Nunavut, Yukon", taxes: [GST] },
];

/** The Canadian postal code shape, ignoring case; the source is served to the browser so it re-quotes on it. */
export const CANADIAN_POSTAL_PATTERN = "^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPR-TV-Z] ?[0-9][ABCEGHJ-NPR-TV-Z][0-9]$";
const CANADIAN_POSTAL_CODE = new RegExp(CANADIAN_POSTAL_PATTERN, "i");
const CANADIAN_POSTAL_MESSAGE = "Enter a valid Canadian postal code.";

const WAREHOUSES: Record<Warehouse, { zone: string; holidays: string[] }> = {
  "San Juan": { zone: "America/Puerto_Rico", holidays: ["2026-11-11", "2026-11-19", "2026-11-26", "2026-12-25", "2027-01-01", "2027-01-06"] },
  Madrid: { zone: "Europe/Madrid", holidays: ["2026-11-02", "2026-11-09", "2026-12-07", "2026-12-08", "2026-12-25", "2027-01-01", "2027-01-06"] },
};
const CUT_OFF_HOUR = 14;

export function country(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

function isCanadianPostalCode(value: unknown): boolean {
  return typeof value === "string" && CANADIAN_POSTAL_CODE.test(value);
}

/** The tax components of a country, by the postal code for Canada (already validated). */
function taxRates(where: Country, postalCode: string): TaxRate[] {
  if (where.taxes) return where.taxes;
  const letter = postalCode.trim().charAt(0).toUpperCase();
  return PROVINCES.find((p) => p.letters.includes(letter))!.taxes;
}

interface TaxComponent {
  name: string;
  rate_pcm: number;
  amount_cents: number;
}

/** Each component rounded half up on its own. */
export function taxComponents(cents: number, rates: { name: string; rate_pcm: number }[]): TaxComponent[] {
  return rates.map(({ name, rate_pcm }) => ({ name, rate_pcm, amount_cents: roundHalfUp(cents * rate_pcm, 100000) }));
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isBusinessDay(date: string, warehouse: Warehouse): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !WAREHOUSES[warehouse].holidays.includes(date);
}

function nextBusinessDay(date: string, warehouse: Warehouse): string {
  let day = addDays(date, 1);
  while (!isBusinessDay(day, warehouse)) day = addDays(day, 1);
  return day;
}

/** Ship date from the 14:00 cut-off in the warehouse's zone, arrival after the transit business days. */
function deliveryDates(where: Country, at: Date): { ships_on: string; arrives_on: string } {
  const wall = wallClock(at, WAREHOUSES[where.warehouse].zone);
  const today = `${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
  const ships = isBusinessDay(today, where.warehouse) && wall.hour < CUT_OFF_HOUR ? today : nextBusinessDay(today, where.warehouse);
  let arrives = ships;
  for (let n = 0; n < where.transit_business_days; n += 1) arrives = nextBusinessDay(arrives, where.warehouse);
  return { ships_on: ships, arrives_on: arrives };
}

interface CreditOption {
  tradeIn: { id: number; quote_cents: number } | null;
  demo: { amount_cents: number } | null;
}

export interface Breakdown {
  lines: CartLine[];
  subtotal_cents: number;
  discounts: { code: string; amount_cents: number }[];
  credits: { kind: "trade_in" | "demo"; amount_cents: number }[];
  taxable_cents: number;
  shipping_cents: number;
  free_shipping: boolean;
  packed_batteries: number;
  standalone_batteries: number;
  dangerous_goods_cents: number;
  taxes: TaxComponent[];
  tax_cents: number;
  total_cents: number;
  ships_on: string;
  arrives_on: string;
  financing: FinancingTerm[];
}

interface Flags {
  country: string;
  postal_code: string;
  use_trade_in: boolean;
  use_demo_credit: boolean;
}

/**
 * The credit flags (JSON booleans, false when missing) and, for Canada, the postal code. `postalField` names the
 * postal code field in the refusal: `postal_code` on quotes, `address.postal_code` on orders.
 */
export function flagFields(body: Record<string, unknown>, postalCode: unknown, postalField: string): Fields {
  const fields: Fields = {};
  for (const flag of ["use_trade_in", "use_demo_credit"] as const) {
    if (body[flag] !== undefined && typeof body[flag] !== "boolean") fields[flag] = "Choose yes or no.";
  }
  if (body.country === "CA" && !isCanadianPostalCode(postalCode)) fields[postalField] = CANADIAN_POSTAL_MESSAGE;
  return fields;
}

export function flagsOf(body: Record<string, unknown>, postalCode: unknown): Flags {
  return {
    country: typeof body.country === "string" ? body.country : "",
    postal_code: typeof postalCode === "string" ? postalCode : "",
    use_trade_in: body.use_trade_in === true,
    use_demo_credit: body.use_demo_credit === true,
  };
}

/** The accepted trade-in and the unused, unexpired demo credit a customer may spend. */
export async function availableCredits(db: Db, userId: number): Promise<CreditOption> {
  const trade = await db.query<{ id: number; quote_cents: number }>(
    "SELECT id, quote_cents FROM trade_ins WHERE user_id = $1 AND status = 'accepted' ORDER BY id LIMIT 1",
    [userId],
  );
  const demo = await db.query<{ amount_cents: number }>(
    "SELECT amount_cents FROM demo_credits WHERE user_id = $1 AND used_order_number IS NULL AND expires_at > $2",
    [userId, now()],
  );
  return { tradeIn: trade.rows[0] ?? null, demo: demo.rows[0] ?? null };
}

function shipTo(flags: Flags): Country {
  const where = country(flags.country);
  if (!where) throw new ApiError("unsupported_country");
  return where;
}

/** A credit flag set without the matching credit (no accepted trade-in, or no unused demo credit valid now). */
function refuseMissingCredit(flags: Flags, credits: CreditOption): void {
  if ((flags.use_trade_in && !credits.tradeIn) || (flags.use_demo_credit && !credits.demo)) throw new ApiError("credit_unavailable");
}

/** Rule refusals in the order of POST /api/orders (country, empty cart, credits), then the computation. */
export function computeBreakdown(lines: PricedLine[], discounts: Breakdown["discounts"], flags: Flags, credits: CreditOption, at: Date): Breakdown {
  const where = shipTo(flags);
  if (!lines.length) throw new ApiError("empty_cart");
  refuseMissingCredit(flags, credits);
  const remaining = new Map(lines.map((l) => [l.id, l.line_cents]));
  const builds = lines.filter((l) => l.type === "build");
  // Ties go to the line added first: lines arrive in the order they were added and only a larger total replaces.
  const highest = (candidates: PricedLine[]) =>
    candidates.reduce<PricedLine | undefined>((best, l) => (!best || remaining.get(l.id)! > remaining.get(best.id)! ? l : best), undefined);
  const applied: Breakdown["credits"] = [];
  if (flags.use_trade_in && credits.tradeIn) {
    const line = highest(builds.filter((l) => l.board_name === "Crest"));
    if (!line) throw new ApiError("trade_in_not_applicable");
    const amount = Math.min(credits.tradeIn.quote_cents, remaining.get(line.id)!);
    remaining.set(line.id, remaining.get(line.id)! - amount);
    applied.push({ kind: "trade_in", amount_cents: amount });
  }
  if (flags.use_demo_credit && credits.demo) {
    const line = highest(builds);
    const amount = line ? Math.min(credits.demo.amount_cents, remaining.get(line.id)!) : 0;
    if (line) remaining.set(line.id, remaining.get(line.id)! - amount);
    applied.push({ kind: "demo", amount_cents: amount });
  }
  const subtotal = lines.reduce((s, l) => s + l.line_cents, 0);
  const taxable = subtotal - discounts.reduce((s, d) => s + d.amount_cents, 0) - applied.reduce((s, c) => s + c.amount_cents, 0);
  const threshold = where.free_accessory_shipping_from_cents;
  const free = threshold !== null && taxable >= threshold;
  const shipping = free ? 0 : builds.length ? where.package_shipping_cents : where.accessory_shipping_cents;
  const packed = builds.reduce((s, l) => s + l.spares * l.quantity, 0);
  const standalone = lines.filter((l) => l.type === "accessory" && l.sku.startsWith("BAT-")).reduce((s, l) => s + l.quantity, 0);
  const dangerous = packed * where.packed_battery_fee_cents + standalone * where.standalone_battery_fee_cents;
  const taxes = taxComponents(taxable, taxRates(where, flags.postal_code));
  const tax = taxes.reduce((s, t) => s + t.amount_cents, 0);
  const total = taxable + shipping + dangerous + tax;
  return {
    lines: lines.map(({ id, type, code, sku, name, quantity, unit_cents, line_cents }) => ({ id, type, code, sku, name, quantity, unit_cents, line_cents })),
    subtotal_cents: subtotal,
    discounts,
    credits: applied,
    taxable_cents: taxable,
    shipping_cents: shipping,
    free_shipping: free,
    packed_batteries: packed,
    standalone_batteries: standalone,
    dangerous_goods_cents: dangerous,
    taxes,
    tax_cents: tax,
    total_cents: total,
    ...deliveryDates(where, at),
    financing: financing(total, where.code),
  };
}

/** POST /api/checkout/quote: the breakdown for the customer's cart; changes nothing. */
export async function quoteCheckout(db: Db, cartId: number | null, userId: number, body: Record<string, unknown>, catalog?: Catalog): Promise<Breakdown> {
  assertValid(flagFields(body, body.postal_code, "postal_code"));
  const flags = flagsOf(body, body.postal_code);
  const credits = await availableCredits(db, userId);
  // The quote publishes no refusal order; it answers a flag without its credit before looking at the cart.
  shipTo(flags);
  refuseMissingCredit(flags, credits);
  const state = await cartState(db, cartId, catalog);
  return computeBreakdown(state.lines, state.cart.codes, flags, credits, now());
}
