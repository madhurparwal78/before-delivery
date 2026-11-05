import type { Pool, PoolClient } from 'pg';
import { percentOf, roundHalfUp, taxOn, termMonths } from '../../shared/money';
import { addDays, isDateString, isoSeconds } from '../../shared/time';
import { tierLabel } from '../../shared/labels';
import {
  INSTRUMENT_TYPES,
  type ContractTerms,
  type InstrumentType,
  type Invoice,
  type PriceList,
  type PriceListItem,
  type Quote,
  type Tier,
} from '../../shared/types';
import { validationFailed } from '../errors';

export type Db = Pool | PoolClient;

interface PriceListRow {
  id: string;
  effective_date: string;
  created_at: Date;
  withdrawn_at: Date | null;
  tax_rate_bp: number;
  items: PriceListItem[];
  tiers: Tier[];
}

function toPriceList(row: PriceListRow): PriceList {
  return {
    id: row.id,
    effective_date: row.effective_date,
    created_at: isoSeconds(row.created_at),
    withdrawn_at: row.withdrawn_at === null ? null : isoSeconds(row.withdrawn_at),
    tax_rate_bp: row.tax_rate_bp,
    items: row.items,
    tiers: row.tiers,
  };
}

const COLUMNS = 'id, to_char(effective_date, \'YYYY-MM-DD\') as effective_date, created_at, withdrawn_at, tax_rate_bp, items, tiers';

/** The version in force on a date: not withdrawn, latest effective date on or before it, newest first. */
export async function priceListInForce(db: Db, date: string): Promise<PriceList | null> {
  const { rows } = await db.query<PriceListRow>(
    `select ${COLUMNS} from price_lists
      where withdrawn_at is null and effective_date <= $1
      order by effective_date desc, created_at desc, seq desc limit 1`,
    [date],
  );
  const row = rows[0];
  return row === undefined ? null : toPriceList(row);
}

export async function priceListById(db: Db, id: string): Promise<PriceList | null> {
  const { rows } = await db.query<PriceListRow>(`select ${COLUMNS} from price_lists where id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : toPriceList(row);
}

export async function allPriceLists(db: Db): Promise<PriceList[]> {
  const { rows } = await db.query<PriceListRow>(
    `select ${COLUMNS} from price_lists order by effective_date desc, created_at desc, seq desc`,
  );
  return rows.map(toPriceList);
}

export function priceListItem(list: PriceList, type: InstrumentType): PriceListItem {
  const item = list.items.find((entry) => entry.instrument_type === type);
  if (item === undefined) throw new Error(`price list ${list.id} has no ${type}`);
  return item;
}

/**
 * The terms every surface of a contract uses: rent, waiver, purchase price, term and tiers from the
 * bound version, with sales tax from the version in force today.
 */
export function contractTerms(
  boundList: PriceList,
  bound: boolean,
  type: InstrumentType,
  todayTaxRateBp: number,
): ContractTerms {
  const item = priceListItem(boundList, type);
  return {
    price_list_id: boundList.id,
    bound,
    base_rent_cents: item.base_rent_cents,
    waiver_cents: item.waiver_cents,
    purchase_price_cents: item.purchase_price_cents,
    tax_rate_bp: todayTaxRateBp,
    term_months: termMonths(item.purchase_price_cents, item.base_rent_cents),
    tiers: boundList.tiers,
  };
}

export function tierForMonth(tiers: Tier[], month: number): Tier {
  for (const tier of tiers) {
    if (month >= tier.from_month && (tier.to_month === null || month <= tier.to_month)) return tier;
  }
  const last = tiers[tiers.length - 1];
  if (last === undefined) throw new Error('a price list always has at least one tier');
  return last;
}

export function buildInvoice(
  contractId: string,
  terms: ContractTerms,
  waiver: boolean,
  billingDate: string | null,
  upcomingBillingDates: string[],
  taxRateBp: number,
): Invoice {
  const waiverCents = waiver ? terms.waiver_cents : 0;
  const taxable = terms.base_rent_cents + waiverCents;
  const lines: Invoice['lines'] = [
    { code: 'base_rent', label: 'Monthly base rent', amount_cents: terms.base_rent_cents },
  ];
  if (waiver) lines.push({ code: 'waiver', label: 'Maintenance and damage waiver', amount_cents: waiverCents });
  lines.push({ code: 'sales_tax', label: 'Sales tax', amount_cents: taxOn(taxable, taxRateBp) });
  return {
    contract_id: contractId,
    price_list_id: terms.price_list_id,
    billing_date: billingDate,
    upcoming_billing_dates: upcomingBillingDates,
    tax_rate_bp: taxRateBp,
    lines,
    total_cents: lines.reduce((sum, line) => sum + line.amount_cents, 0),
  };
}

export function computeQuote(
  contractId: string,
  terms: ContractTerms,
  equityCents: number,
  contractMonth: number,
  month: number,
  today: string,
): Quote {
  const price = terms.purchase_price_cents;
  const equityAtMonth =
    month < contractMonth
      ? month * terms.base_rent_cents
      : Math.min(price, equityCents + (month - contractMonth) * terms.base_rent_cents);
  const remaining = price - equityAtMonth;
  const tier = tierForMonth(terms.tiers, month);
  const discount = percentOf(remaining, tier.percent);
  const payoff = remaining - discount;
  const tax = taxOn(payoff, terms.tax_rate_bp);
  return {
    contract_id: contractId,
    month,
    term_months: terms.term_months,
    paid: month <= contractMonth,
    equity_cents: equityAtMonth,
    remaining_cents: remaining,
    tier: { label: tier.label, percent: tier.percent },
    discount_cents: discount,
    payoff_cents: payoff,
    tax_cents: tax,
    total_cents: payoff + tax,
    valid_until: addDays(today, 7),
  };
}

export interface PriceListDraft {
  effective_date: string;
  tax_rate_bp: number;
  items: PriceListItem[];
  tiers: Tier[];
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Validates a new price list, naming every invalid field at once. */
export function validatePriceList(body: unknown, today: string): PriceListDraft {
  const fields: Record<string, string> = {};
  const raw = asRecord(body);

  const effectiveDate = raw.effective_date;
  const effectiveDateValid =
    typeof effectiveDate === 'string' && isDateString(effectiveDate) && effectiveDate >= today;
  if (!effectiveDateValid) fields.effective_date = 'Use a date from today on, as YYYY-MM-DD.';

  const taxRate = raw.tax_rate_bp;
  const taxRateValid = isWholeNumber(taxRate) && taxRate >= 0 && taxRate <= 2000;
  if (!taxRateValid) fields.tax_rate_bp = 'Enter a rate from 0.00% to 20.00%.';

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items: PriceListItem[] = [];
  const seenTypes = new Set<string>();
  for (const entry of rawItems) {
    const item = asRecord(entry);
    const type = item.instrument_type;
    if (typeof type !== 'string' || !INSTRUMENT_TYPES.includes(type as InstrumentType) || seenTypes.has(type)) {
      continue;
    }
    seenTypes.add(type);
    const rent = item.base_rent_cents;
    const waiver = item.waiver_cents;
    const price = item.purchase_price_cents;
    const rentValid = isWholeNumber(rent) && rent >= 100 && rent <= 100000;
    if (!rentValid) fields[`items.${type}.base_rent_cents`] = 'Enter a monthly rent from $1.00 to $1,000.00.';
    if (!(isWholeNumber(waiver) && waiver >= 0 && waiver <= 10000)) {
      fields[`items.${type}.waiver_cents`] = 'Enter a waiver from $0.00 to $100.00.';
    }
    if (
      !(
        isWholeNumber(price) &&
        price >= 1000 &&
        price <= 1000000 &&
        (!rentValid || price >= (rent as number))
      )
    ) {
      fields[`items.${type}.purchase_price_cents`] =
        'Enter a purchase price from $10.00 to $10,000.00, at least the monthly rent.';
    }
    items.push({
      instrument_type: type as InstrumentType,
      base_rent_cents: rent as number,
      waiver_cents: waiver as number,
      purchase_price_cents: price as number,
    });
  }
  if (seenTypes.size !== INSTRUMENT_TYPES.length) fields.items = 'Give one price for each of the five instruments.';

  const rawTiers = Array.isArray(raw.tiers) ? raw.tiers : [];
  const tiers: Tier[] = [];
  if (rawTiers.length < 1 || rawTiers.length > 6) fields.tiers = 'Add between 1 and 6 tiers.';
  rawTiers.forEach((entry, index) => {
    const tier = asRecord(entry);
    const name = tier.name;
    const fromMonth = tier.from_month;
    const toMonth = tier.to_month === undefined ? null : tier.to_month;
    const percent = tier.percent;
    if (!(typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 30)) {
      fields[`tiers.${index}.name`] = 'Name this tier in 1 to 30 characters.';
    }
    const previous = rawTiers[index - 1] === undefined ? null : asRecord(rawTiers[index - 1]);
    const expectedFrom =
      index === 0
        ? 0
        : isWholeNumber(previous?.to_month) && previous?.to_month !== null
          ? (previous?.to_month as number) + 1
          : null;
    if (!(isWholeNumber(fromMonth) && expectedFrom !== null && fromMonth === expectedFrom)) {
      fields[`tiers.${index}.from_month`] =
        index === 0 ? 'The first tier starts at month 0.' : 'Start this tier the month after the previous tier ends.';
    }
    const isLast = index === rawTiers.length - 1;
    const toMonthValid =
      toMonth === null
        ? isLast
        : isWholeNumber(toMonth) && (!isWholeNumber(fromMonth) || toMonth >= (fromMonth as number));
    if (!toMonthValid) {
      fields[`tiers.${index}.to_month`] = 'End this tier at or after its start; only the last tier is open-ended.';
    }
    if (!(isWholeNumber(percent) && percent >= 0 && percent <= 90)) {
      fields[`tiers.${index}.percent`] = 'Enter a whole percent from 0 to 90.';
    }
    tiers.push({
      from_month: fromMonth as number,
      to_month: toMonth as number | null,
      percent: percent as number,
      name: typeof name === 'string' ? name.trim() : '',
      label: tierLabel(typeof name === 'string' ? name.trim() : '', percent as number),
    });
  });

  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  return {
    effective_date: effectiveDate as string,
    tax_rate_bp: taxRate as number,
    items,
    tiers,
  };
}

/** Sales tax on a taxable amount, kept here so one rounding rule serves every surface. */
export function salesTax(amountCents: number, taxRateBp: number): number {
  return taxOn(amountCents, taxRateBp);
}

export function proportion(amountCents: number, numerator: number, denominator: number): number {
  return roundHalfUp(BigInt(amountCents) * BigInt(numerator), BigInt(denominator));
}
