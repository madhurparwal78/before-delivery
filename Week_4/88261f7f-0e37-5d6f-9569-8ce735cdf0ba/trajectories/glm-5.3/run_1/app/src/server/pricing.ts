import { addDays, dateRange, isWeekend, weekday } from './dates.js';
import { halfUp } from '../shared/format.js';

export interface RatePlanRow {
  id: string;
  name: string;
  weeknightCents: number;
  weekendCents: number;
}

export interface TaxRateRow {
  id: string;
  percent: string;
  startDate: string | null;
}

export const EXTRA_GUEST_CENTS = 2500;
export const EXTRA_GUESTS_INCLUDED = 2;
export const CITY_TAX_PER_GUEST_CENTS = 200;
export const DEFAULT_TAX_BPS = 875;

export function lengthDiscountBps(totalNights: number): number {
  if (totalNights <= 2) return 0;
  if (totalNights <= 6) return 500;
  return 1000;
}

export function planPriceForNight(plan: RatePlanRow, date: string): number {
  return isWeekend(date) ? plan.weekendCents : plan.weeknightCents;
}

export function taxRateForNight(taxRates: TaxRateRow[], date: string): number {
  let percentBps = DEFAULT_TAX_BPS;
  let bestStart: string | null = null;
  for (const rate of taxRates) {
    if (rate.startDate !== null && rate.startDate <= date) {
      if (bestStart === null || rate.startDate > bestStart) {
        bestStart = rate.startDate;
        percentBps = taxPercentToBps(rate.percent);
      }
    }
  }
  return percentBps;
}

export function taxPercentToBps(percent: string): number {
  return Math.round(Number(percent) * 100);
}

/** Price one night of a stay in exact integers, rounding half up once. */
export function priceNight(args: {
  plan: RatePlanRow;
  taxRates: TaxRateRow[];
  date: string;
  guests: number;
  totalNights: number;
}): { roomCents: number; taxCents: number; cityTaxCents: number; totalCents: number } {
  const base = planPriceForNight(args.plan, args.date)
    + Math.max(0, args.guests - EXTRA_GUESTS_INCLUDED) * EXTRA_GUEST_CENTS;
  const discountBps = lengthDiscountBps(args.totalNights);
  const roomCents = halfUp(base * (10000 - discountBps), 10000);
  const taxBps = taxRateForNight(args.taxRates, args.date);
  const taxCents = halfUp(roomCents * taxBps, 10000);
  const cityTaxCents = args.guests * CITY_TAX_PER_GUEST_CENTS;
  return { roomCents, taxCents, cityTaxCents, totalCents: roomCents + taxCents + cityTaxCents };
}

export function priceStay(args: {
  plan: RatePlanRow;
  taxRates: TaxRateRow[];
  arrival: string;
  departure: string;
  guests: number;
  roomNumber: string;
}): { date: string; roomNumber: string; roomCents: number; taxCents: number; cityTaxCents: number; totalCents: number }[] {
  const nights = dateRange(args.arrival, addDays(args.departure, -1));
  const totalNights = nights.length;
  return nights.map(date => {
    const priced = priceNight({ plan: args.plan, taxRates: args.taxRates, date, guests: args.guests, totalNights });
    return { date, roomNumber: args.roomNumber, ...priced, totalCents: priced.totalCents };
  });
}
