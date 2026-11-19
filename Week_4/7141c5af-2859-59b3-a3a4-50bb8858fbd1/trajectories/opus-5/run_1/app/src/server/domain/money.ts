/**
 * Money and the estimate arithmetic. Rounding happens at exactly one stage per
 * line, half up on the exact value, and amounts are kept in minor units.
 */
import {
  type Dec,
  add,
  ceilDiv,
  cmp,
  dec,
  divHalfUp,
  floorToScale,
  fromInt,
  groupThousands,
  isWhole,
  mul,
  parseDec,
  roundHalfUp,
  toFixed,
} from './decimal.ts';
import type { Town } from './time.ts';

export type Currency = 'EUR' | 'GBP' | 'USD' | 'JPY' | 'AED';

export const CURRENCIES: readonly Currency[] = ['EUR', 'GBP', 'USD', 'JPY', 'AED'];

export const MINOR_DIGITS: Record<Currency, number> = {
  EUR: 2,
  GBP: 2,
  USD: 2,
  JPY: 0,
  AED: 2,
};

export const TOWN_CURRENCY: Record<Town, Currency> = {
  Turin: 'EUR',
  London: 'GBP',
  'New York': 'USD',
  Kyoto: 'JPY',
  Dubai: 'AED',
};

export const TOWN_TAX_PERCENT: Record<Town, number> = {
  Turin: 22,
  London: 20,
  'New York': 0,
  Kyoto: 0,
  Dubai: 0,
};

const PREFIX: Record<Currency, string> = {
  EUR: '\u20ac',
  GBP: '\u00a3',
  USD: 'US$',
  JPY: '\u00a5',
  AED: 'AED ',
};

/** `€2,102.71`, `US$2,102.71`, `¥104,973`, `AED 2,102.71`. */
export function formatMinor(currency: Currency, minor: bigint): string {
  const digits = MINOR_DIGITS[currency];
  const neg = minor < 0n;
  const value = dec(neg ? -minor : minor, digits);
  return (neg ? '-' : '') + PREFIX[currency] + groupThousands(toFixed(value, digits));
}

/** A rate or price as an amount in its currency. */
export function formatAmount(currency: Currency, amount: Dec): string {
  return formatMinor(currency, toMinor(currency, amount));
}

/** Half up on the exact value, to the currency's smallest unit. */
export function toMinor(currency: Currency, amount: Dec): bigint {
  return roundHalfUp(amount, MINOR_DIGITS[currency]).units;
}

export function minorToDec(currency: Currency, minor: bigint): Dec {
  return dec(minor, MINOR_DIGITS[currency]);
}

/**
 * 30%, 40% and 30% of the total rounded down, with any remaining smallest
 * units going one each to the earlier milestones first.
 */
export const MILESTONE_PERCENTS: readonly number[] = [30, 40, 30];

export function splitMilestones(totalMinor: bigint): bigint[] {
  const parts = MILESTONE_PERCENTS.map((p) => (totalMinor * BigInt(p)) / 100n);
  let remainder = totalMinor - parts.reduce((a, b) => a + b, 0n);
  for (let i = 0; remainder > 0n; i = (i + 1) % parts.length) {
    parts[i] = parts[i]! + 1n;
    remainder -= 1n;
  }
  return parts;
}

// ------------------------------------------------------------------ quantities

/** One square foot is exactly 929.0304 square centimetres. */
export const SQ_CM_PER_SQ_FT = dec(9_290_304n, 4);
const WASTE_FACTOR = dec(115n, 2);
const QUARTER = dec(25n, 2);

export function sqCmToSqFt(sqCm: number | bigint, places = 2): Dec {
  return divHalfUp(fromInt(sqCm), SQ_CM_PER_SQ_FT, places);
}

/** `48.25 sq ft (4.48 m²)`. */
export function sqFtWithMetres(sqFt: Dec): string {
  const m2 = mul(sqFt, dec(9_290_304n, 8));
  return `${toFixed(sqFt, 2)} sq ft (${toFixed(m2, 2)} m\u00b2)`;
}

/** Pattern area times 1.15 over the lot's average, rounded up. */
export function hidesNeeded(patternAreaSqFt: Dec, lotAverageSqFt: Dec): number {
  return Number(ceilDiv(mul(patternAreaSqFt, WASTE_FACTOR), lotAverageSqFt));
}

/** Fabric is sold in quarter metres rounded up. */
export function quarterMetres(metres: Dec): Dec {
  const quarters = ceilDiv(metres, QUARTER);
  return mul(dec(quarters, 0), QUARTER);
}

// ------------------------------------------------------------------- estimates

export interface EstimateMaterial {
  pricePerUnit: Dec;
  unit: 'sqFt' | 'metre';
  /** Leather only: the chosen lot's average hide size. */
  lotAverageSqFt?: Dec;
}

export interface EstimateInput {
  currency: Currency;
  taxPercent: number;
  labourHours: Dec;
  labourRate: Dec;
  material: EstimateMaterial | null;
  patternAreaSqFt?: Dec;
  metres?: Dec;
}

export interface EstimateAmounts {
  hides: number | null;
  metres: Dec | null;
  materialMinor: bigint;
  labourMinor: bigint;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  milestonesMinor: bigint[];
}

/**
 * The one place the estimate arithmetic lives: each line is rounded half up to
 * the smallest unit on its exact value, the subtotal is their sum, tax is half
 * up on the subtotal and the total is their sum.
 */
export function computeEstimate(input: EstimateInput): EstimateAmounts {
  const { currency } = input;
  let hides: number | null = null;
  let metres: Dec | null = null;
  let materialAmount: Dec = fromInt(0);

  if (input.material) {
    if (input.material.unit === 'sqFt') {
      const area = input.patternAreaSqFt ?? fromInt(0);
      const average = input.material.lotAverageSqFt ?? fromInt(0);
      hides = hidesNeeded(area, average);
      // Leather is sold by the whole hide.
      materialAmount = mul(mul(fromInt(hides), average), input.material.pricePerUnit);
    } else {
      metres = quarterMetres(input.metres ?? fromInt(0));
      materialAmount = mul(metres, input.material.pricePerUnit);
    }
  }

  const materialMinor = toMinor(currency, materialAmount);
  const labourMinor = toMinor(currency, mul(input.labourHours, input.labourRate));
  const subtotalMinor = materialMinor + labourMinor;
  // Tax is half up on the subtotal, taken on the exact percentage of it.
  const taxMinor = roundHalfUp(dec(subtotalMinor * BigInt(input.taxPercent), 2), 0).units;
  const totalMinor = subtotalMinor + taxMinor;

  return {
    hides,
    metres,
    materialMinor,
    labourMinor,
    subtotalMinor,
    taxMinor,
    totalMinor,
    milestonesMinor: splitMilestones(totalMinor),
  };
}

/** Labour is booked in quarter hours. */
export function isQuarterHour(hours: Dec): boolean {
  return isWhole(mul(hours, fromInt(4)));
}

export function priceOf(prices: Record<string, string>, currency: Currency): Dec {
  const text = prices[currency.toLowerCase()];
  const parsed = text === undefined ? null : parseDec(text);
  if (!parsed) throw new Error(`no ${currency} price`);
  return parsed;
}

export { add, cmp, floorToScale };
