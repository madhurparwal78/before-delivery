import { multiply, parseDecimal, rational, roundHalfUp } from './rational.js';
import type { Place } from './time.js';

export const CURRENCIES = ['EUR', 'CAD', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

const SYMBOLS: Record<Currency, string> = { EUR: '€', CAD: 'CA$', USD: 'US$' };

/** Tax follows the client's place. */
const TAX_PERCENT: Record<Place, number> = {
  netherlands: 21,
  ontario: 13,
  newYork: 0,
  dubai: 0,
};

/** A fee is a decimal string above 0 with `.` and at most two decimals. */
export function parseFeeMinor(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = parseDecimal(text, '.');
  if (value === null) return null;
  const minor = Number(roundHalfUp(multiply(value, rational(100))));
  return minor > 0 ? minor : null;
}

export type Milestone = {
  number: number;
  amountMinor: number;
  taxMinor: number;
  amountText: string;
  taxText: string;
};

/** The fee splits across three milestones exactly, the earlier ones taking the extra cents. */
export function splitMilestones(feeMinor: number): number[] {
  const base = Math.floor(feeMinor / 3);
  const extra = feeMinor - base * 3;
  return [0, 1, 2].map((index) => base + (index < extra ? 1 : 0));
}

/** Tax is worked out on each milestone on its own, half up to the cent. */
export function milestoneTaxMinor(amountMinor: number, place: Place): number {
  const percent = TAX_PERCENT[place];
  return Number(roundHalfUp(multiply(rational(amountMinor * percent), rational(1, 100))));
}

export function buildMilestones(
  feeMinor: number,
  place: Place,
  currency: Currency,
): { milestones: Milestone[]; taxMinor: number } {
  const amounts = splitMilestones(feeMinor);
  const milestones = amounts.map((amountMinor, index) => {
    const taxMinor = milestoneTaxMinor(amountMinor, place);
    return {
      number: index + 1,
      amountMinor,
      taxMinor,
      amountText: moneyText(amountMinor, currency),
      taxText: moneyText(taxMinor, currency),
    };
  });
  return {
    milestones,
    taxMinor: milestones.reduce((sum, milestone) => sum + milestone.taxMinor, 0),
  };
}

/** `€1,835.50`, `CA$1,835.50`, `US$1,835.50`. */
export function moneyText(minor: number, currency: Currency): string {
  const negative = minor < 0;
  const digits = Math.abs(minor).toString().padStart(3, '0');
  const whole = digits.slice(0, digits.length - 2);
  const cents = digits.slice(digits.length - 2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${SYMBOLS[currency]}${grouped}.${cents}`;
}
