import { weekday, type IsoDate } from "../../shared/dates";
import { roundHalfUp } from "../../shared/money";

const EXTRA_GUEST_CENTS = 2500;
const INCLUDED_GUESTS = 2;
const CITY_TAX_PER_GUEST_CENTS = 200;
const PERCENT_DENOMINATOR = 100;
const HUNDREDTHS_DENOMINATOR = 10_000;
const FRIDAY = 5;
const SATURDAY = 6;
const SHORT_STAY_NIGHTS = 3;
const LONG_STAY_NIGHTS = 7;

export interface PlanPrices { weeknightCents: number; weekendCents: number }
export interface TaxRateInForce { hundredths: number; startDate: IsoDate | null }

/** Length-of-stay discount in whole percent, by the stay's total nights. */
function discountPercent(totalNights: number): number {
  if (totalNights >= LONG_STAY_NIGHTS) return 10;
  return totalNights >= SHORT_STAY_NIGHTS ? 5 : 0;
}

/** The room amount of one night: plan price for its weekday, extra guests, discount, one half-up rounding. */
export function nightRoomCents(plan: PlanPrices, night: IsoDate, guests: number, totalNights: number): number {
  const day = weekday(night);
  const price = day === FRIDAY || day === SATURDAY ? plan.weekendCents : plan.weeknightCents;
  const base = price + Math.max(0, guests - INCLUDED_GUESTS) * EXTRA_GUEST_CENTS;
  return roundHalfUp(base * (PERCENT_DENOMINATOR - discountPercent(totalNights)), PERCENT_DENOMINATOR);
}

/** The percentage in force on a night: the latest rate that has started, else the default. */
export function taxRateHundredths(rates: readonly TaxRateInForce[], night: IsoDate): number {
  let current = rates.find((rate) => rate.startDate === null)?.hundredths ?? 0;
  let currentStart = "";
  for (const rate of rates) {
    if (rate.startDate !== null && rate.startDate <= night && rate.startDate > currentStart) {
      current = rate.hundredths;
      currentStart = rate.startDate;
    }
  }
  return current;
}

export function taxCents(roomCents: number, hundredths: number): number {
  return roundHalfUp(roomCents * hundredths, HUNDREDTHS_DENOMINATOR);
}

export function cityTaxCents(guests: number): number {
  return guests * CITY_TAX_PER_GUEST_CENTS;
}
