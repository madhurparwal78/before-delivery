// Price lists, a contract's terms, the monthly invoice, the payment split, quotes and billing dates.
// Each rule is decided here once and reused by every surface.

import type { Invoice, PriceList, PriceListItem, Quote, Terms, Tier } from "../../shared/api.js";
import { applyBasisPoints, quotientCeil, quotientFloor, roundHalfUp } from "../../shared/money.js";
import { priceListInForce, tierLabel } from "../../shared/priceLists.js";
import { addDays, addMonthsClamped, isoSecond } from "../../shared/storeTime.js";
import type { InstrumentType } from "../../shared/vocabulary.js";
import { query, type Queryable } from "../db/pool.js";

export interface PriceListRow {
  id: string; effective_date: string; created_at: Date; withdrawn_at: Date | null; tax_rate_bp: number;
  items: PriceListItem[]; tiers: Omit<Tier, "label">[];
}

function withLabels(tiers: readonly Omit<Tier, "label">[]): Tier[] {
  return tiers.map((t) => ({ from_month: t.from_month, to_month: t.to_month, percent: t.percent, name: t.name,
    label: tierLabel(t.name, t.percent) }));
}

export function priceListBody(row: PriceListRow): PriceList {
  return {
    id: row.id, effective_date: row.effective_date, created_at: isoSecond(row.created_at),
    withdrawn_at: row.withdrawn_at === null ? null : isoSecond(row.withdrawn_at), tax_rate_bp: row.tax_rate_bp,
    items: row.items.map((i) => ({ instrument_type: i.instrument_type, base_rent_cents: i.base_rent_cents,
      waiver_cents: i.waiver_cents, purchase_price_cents: i.purchase_price_cents })),
    tiers: withLabels(row.tiers),
  };
}

/** Every version, newest effective date first, then newest created first. */
export async function loadPriceLists(db: Queryable): Promise<PriceList[]> {
  const rows = await query<PriceListRow>(db, `SELECT id, effective_date, created_at, withdrawn_at, tax_rate_bp, items, tiers
    FROM price_lists ORDER BY effective_date DESC, created_order DESC`);
  return rows.map(priceListBody);
}

/** The one element `test` picks; price lists always hold one item per type and tiers that cover every month. */
function only<T>(items: readonly T[], test: (item: T) => boolean, what: string): T {
  const found = items.find(test);
  if (found === undefined) throw new Error(`price list data has no ${what}`);
  return found;
}

/** The version in force on `date`. The seed version is in force from 2024-01-01 and can never be withdrawn. */
export function inForceOn(lists: readonly PriceList[], date: string): PriceList {
  const version = priceListInForce(lists, date);
  return only(lists, (v) => v === version, `version in force on ${date}`);
}

export function versionOf(lists: readonly PriceList[], id: string): PriceList {
  return only(lists, (l) => l.id === id, `version ${id}`);
}

interface TermsSource { instrument_type: InstrumentType; price_list_id: string | null }

/**
 * A contract's terms: the bound version once signed, otherwise the version in force today. Sales tax never follows
 * the bound version: it is today's rate.
 */
export function contractTerms(contract: TermsSource, lists: readonly PriceList[], today: string): Terms {
  const version = contract.price_list_id === null ? inForceOn(lists, today)
    : versionOf(lists, contract.price_list_id);
  const item = only(version.items, (i) => i.instrument_type === contract.instrument_type, contract.instrument_type);
  return {
    price_list_id: version.id, bound: contract.price_list_id !== null, base_rent_cents: item.base_rent_cents,
    waiver_cents: item.waiver_cents, purchase_price_cents: item.purchase_price_cents,
    tax_rate_bp: inForceOn(lists, today).tax_rate_bp,
    term_months: quotientCeil(item.purchase_price_cents, item.base_rent_cents), tiers: version.tiers,
  };
}

/** The waiver line of a contract: the version's waiver when chosen, otherwise nothing. */
function waiverLine(terms: Terms, waiver: boolean): number {
  return waiver ? terms.waiver_cents : 0;
}

/** Monthly sales tax on base rent plus waiver at `taxRateBp`. */
function monthlyTax(terms: Terms, waiver: boolean, taxRateBp: number): number {
  return applyBasisPoints(terms.base_rent_cents + waiverLine(terms, waiver), taxRateBp);
}

interface Split { base_rent_cents: number; waiver_cents: number; tax_cents: number }

/** The published payment split at today's rate; the three parts always add up to the amount. */
export function splitPayment(amount: number, terms: Terms, waiver: boolean): Split {
  const w = waiverLine(terms, waiver);
  const t = monthlyTax(terms, waiver, terms.tax_rate_bp);
  const total = BigInt(terms.base_rent_cents + w + t);
  const tax = roundHalfUp(BigInt(amount) * BigInt(t), total);
  const waiverPart = roundHalfUp(BigInt(amount) * BigInt(w), total);
  return { base_rent_cents: amount - tax - waiverPart, waiver_cents: waiverPart, tax_cents: tax };
}

/** Equity ÷ base rent, rounded down. */
export function contractMonth(equity: number, terms: Terms): number {
  return quotientFloor(equity, terms.base_rent_cents);
}

/** The quote for month N; tier choice and payoff live only here. */
export function quoteFor(contractId: string, terms: Terms, equity: number, month: number, today: string): Quote {
  const current = contractMonth(equity, terms);
  const price = terms.purchase_price_cents;
  const equityAt = month < current ? month * terms.base_rent_cents
    : Math.min(price, equity + (month - current) * terms.base_rent_cents);
  const remaining = price - equityAt;
  const tier = only(terms.tiers, (t) => t.from_month <= month && (t.to_month === null || month <= t.to_month),
    `tier for month ${month}`);
  const discount = roundHalfUp(BigInt(remaining) * BigInt(tier.percent), 100n);
  const payoff = remaining - discount;
  const tax = applyBasisPoints(payoff, terms.tax_rate_bp);
  return {
    contract_id: contractId, month, term_months: terms.term_months, paid: month <= current, equity_cents: equityAt,
    remaining_cents: remaining, tier: { label: tier.label, percent: tier.percent }, discount_cents: discount,
    payoff_cents: payoff, tax_cents: tax, total_cents: payoff + tax, valid_until: addDays(today, 7),
  };
}

/** Billing date k is the anchor plus k months (day clamped); `count` dates from the first on or after today. */
export function billingDates(anchor: string, today: string, count: number): string[] {
  let k = 1;
  while (addMonthsClamped(anchor, k) < today) k += 1;
  return Array.from({ length: count }, (_, i) => addMonthsClamped(anchor, k + i));
}

export function invoiceFor(contract: { id: string; status: string; waiver: boolean; billing_anchor_date: string | null },
  terms: Terms, lists: readonly PriceList[], today: string): Invoice {
  const dates = contract.status === "active" && contract.billing_anchor_date !== null
    ? billingDates(contract.billing_anchor_date, today, 4) : [];
  const billingDate = dates[0] ?? null;
  const taxRate = billingDate === null ? terms.tax_rate_bp : inForceOn(lists, billingDate).tax_rate_bp;
  const lines: Invoice["lines"] = [{ code: "base_rent", label: "Base rent", amount_cents: terms.base_rent_cents }];
  if (contract.waiver) lines.push({ code: "waiver", label: "Maintenance and damage waiver", amount_cents: terms.waiver_cents });
  lines.push({ code: "sales_tax", label: "Sales tax", amount_cents: monthlyTax(terms, contract.waiver, taxRate) });
  return {
    contract_id: contract.id, price_list_id: terms.price_list_id, billing_date: billingDate,
    upcoming_billing_dates: dates, tax_rate_bp: taxRate, lines,
    total_cents: lines.reduce((sum, line) => sum + line.amount_cents, 0),
  };
}
