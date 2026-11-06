import type { BaseKey } from '../../shared/format.js';
import { convertMinor, parseDecimal, percentOfMinor, type Decimal } from './money.js';
import { VAT_PERCENT, type Season } from './weeks.js';

export type LineKind = 'charter_fee' | 'provisioning_allowance' | 'vat';
export const PROVISIONING_PERCENT = 30n;

export interface CharterLine {
  readonly kind: LineKind;
  readonly label: string;
  readonly eurMinor: bigint;
  readonly amountMinor: bigint;
}

export interface CharterQuote {
  readonly lines: readonly CharterLine[];
  readonly totalEurMinor: bigint;
  readonly totalMinor: bigint;
}

export interface YachtRates {
  readonly lowMinor: bigint;
  readonly shoulderMinor: bigint;
  readonly highMinor: bigint;
}

export function weeklyRateMinor(rates: YachtRates, season: Season): bigint {
  if (season === 'high') return rates.highMinor;
  if (season === 'shoulder') return rates.shoulderMinor;
  return rates.lowMinor;
}

export function vatPercentFor(base: BaseKey): bigint {
  return VAT_PERCENT[base];
}

/**
 * The one charter pricing rule: season rate, a 30% provisioning allowance and
 * the base country's VAT on the charter fee alone, each line converted on its own.
 */
export function priceCharter(options: {
  readonly rates: YachtRates;
  readonly season: Season;
  readonly base: BaseKey;
  readonly rate: Decimal;
}): CharterQuote {
  const feeEur = weeklyRateMinor(options.rates, options.season);
  const provisioningEur = percentOfMinor(feeEur, PROVISIONING_PERCENT);
  const vatPercent = vatPercentFor(options.base);
  const vatEur = percentOfMinor(feeEur, vatPercent);
  const lines: CharterLine[] = [
    {
      kind: 'charter_fee',
      label: 'Charter fee',
      eurMinor: feeEur,
      amountMinor: convertMinor(feeEur, options.rate),
    },
    {
      kind: 'provisioning_allowance',
      label: 'Provisioning allowance (30%)',
      eurMinor: provisioningEur,
      amountMinor: convertMinor(provisioningEur, options.rate),
    },
    {
      kind: 'vat',
      label: `VAT ${vatPercent}% on charter fee`,
      eurMinor: vatEur,
      amountMinor: convertMinor(vatEur, options.rate),
    },
  ];
  return {
    lines,
    totalEurMinor: lines.reduce((sum, line) => sum + line.eurMinor, 0n),
    totalMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0n),
  };
}

export const CURRENCIES = ['EUR', 'GBP', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface ExchangeTableRow {
  readonly id: string;
  readonly effective_date: string;
  readonly rate_gbp: string;
  readonly rate_usd: string;
}

export function rateFor(table: ExchangeTableRow | null, currency: Currency): Decimal {
  if (currency === 'EUR') return parseDecimal('1');
  if (table === null) throw new Error('No exchange table in force');
  return parseDecimal(currency === 'GBP' ? table.rate_gbp : table.rate_usd);
}
