import { divideRoundHalfUp } from '../../shared/money';
import { addDays, isWeekendNight, PlainDate } from '../../shared/dates';
import { DEFAULT_TAX_PERCENT, taxPercentHundredths } from '../../shared/rates';

const EXTRA_GUEST_CENTS = 2500;
const CITY_TAX_CENTS_PER_GUEST = 200;
const FREE_GUEST_COUNT = 2;
export const MAX_STAY_NIGHTS = 90;
export const MIN_GUESTS = 1;
export const MAX_GUESTS = 6;

export interface RatePlanPrices {
  weeknightCents: number;
  weekendCents: number;
}

export interface TaxRateInForce {
  percent: string;
  startDate: PlainDate | null;
}

function discountHundredthsForNights(totalNights: number): number {
  if (totalNights >= 7) return 1000;
  if (totalNights >= 3) return 500;
  return 0;
}

function baseCentsForNight(plan: RatePlanPrices, date: PlainDate, guests: number): number {
  const nightly = isWeekendNight(date) ? plan.weekendCents : plan.weeknightCents;
  const extraGuests = Math.max(0, guests - FREE_GUEST_COUNT);
  return nightly + extraGuests * EXTRA_GUEST_CENTS;
}

/** The night's room amount: the plan's price for its weekday, less the length-of-stay discount. */
function roomCentsForNight(
  plan: RatePlanPrices,
  date: PlainDate,
  guests: number,
  totalNights: number,
): number {
  const base = baseCentsForNight(plan, date, guests);
  const keptHundredths = 10000 - discountHundredthsForNights(totalNights);
  return divideRoundHalfUp(base * keptHundredths, 10000);
}

/** The percentage rate in force on a night: the latest rate that has started by then. */
function taxRateOnNight(rates: TaxRateInForce[], date: PlainDate): string {
  let inForce = DEFAULT_TAX_PERCENT;
  let bestStart: PlainDate | null = null;
  for (const rate of rates) {
    if (rate.startDate === null) {
      if (bestStart === null) inForce = rate.percent;
      continue;
    }
    if (rate.startDate <= date && (bestStart === null || rate.startDate > bestStart)) {
      bestStart = rate.startDate;
      inForce = rate.percent;
    }
  }
  return inForce;
}

function taxCentsForRoom(roomCents: number, percent: string): number {
  return divideRoundHalfUp(roomCents * taxPercentHundredths(percent), 10000);
}

function cityTaxCentsForNight(guests: number): number {
  return CITY_TAX_CENTS_PER_GUEST * guests;
}

export interface NightPrice {
  date: PlainDate;
  roomCents: number;
  taxCents: number;
  cityTaxCents: number;
  totalCents: number;
}

export function priceRoomNights(
  plan: RatePlanPrices,
  arrival: PlainDate,
  totalNights: number,
  guests: number,
): Array<{ date: PlainDate; roomCents: number }> {
  const nights: Array<{ date: PlainDate; roomCents: number }> = [];
  for (let index = 0; index < totalNights; index += 1) {
    const date = addDays(arrival, index);
    nights.push({ date, roomCents: roomCentsForNight(plan, date, guests, totalNights) });
  }
  return nights;
}

/** Tax and city tax over room amounts already fixed on the stay. */
export function completeNight(
  roomCents: number,
  date: PlainDate,
  guests: number,
  rates: TaxRateInForce[],
): NightPrice {
  const taxCents = taxCentsForRoom(roomCents, taxRateOnNight(rates, date));
  const cityTaxCents = cityTaxCentsForNight(guests);
  return { date, roomCents, taxCents, cityTaxCents, totalCents: roomCents + taxCents + cityTaxCents };
}
