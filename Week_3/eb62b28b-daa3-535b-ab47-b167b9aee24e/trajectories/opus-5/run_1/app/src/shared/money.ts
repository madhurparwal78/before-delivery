import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });

export type Cadence = 'sixMonths' | 'yearly';

export const CADENCE_MONTHS: Record<Cadence, number> = { sixMonths: 6, yearly: 12 };

const SIX_MONTH_PRICE = new Decimal('749.95');
const YEARLY_DISCOUNT = new Decimal('0.85');
const MEMBER_BLEND_SHARE = new Decimal('0.85');

/** Rounds a decimal to whole cents, half up. */
export function toCents(amount: Decimal): number {
  return amount.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function roundCentsHalfUp(cents: Decimal): number {
  return cents.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function plusPriceCents(cadence: Cadence): number {
  if (cadence === 'sixMonths') return toCents(SIX_MONTH_PRICE);
  return toCents(SIX_MONTH_PRICE.times(2).times(YEARLY_DISCOUNT));
}

export function perMonthCents(cadence: Cadence): number {
  const period = new Decimal(plusPriceCents(cadence));
  return roundCentsHalfUp(period.dividedBy(CADENCE_MONTHS[cadence]));
}

export function memberBlendPriceCents(listPriceCents: number): number {
  return roundCentsHalfUp(new Decimal(listPriceCents).times(MEMBER_BLEND_SHARE));
}

/** `$1,274.92` */
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${String(remainder).padStart(2, '0')}`;
}

export { Decimal };
