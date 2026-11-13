import { Decimal } from '../shared/money';
import { DateOnly, wholeYearsBetween } from '../shared/time';

export type AgeBand = 'age18To39' | 'age40To59' | 'age60Plus';
export type Flag = 'belowRange' | 'inRange' | 'optimal' | 'aboveRange';

export const AGE_BANDS: AgeBand[] = ['age18To39', 'age40To59', 'age60Plus'];
export const SEXES: ('female' | 'male')[] = ['female', 'male'];

export interface RangeRow {
  sex: 'female' | 'male';
  ageBand: AgeBand;
  low: string;
  high: string;
  optimalLow: string;
  optimalHigh: string;
}

/** Whole years of age on the collected date in the member's own local date. */
export function ageBandOn(dateOfBirth: DateOnly, collectedLocalDate: DateOnly): AgeBand {
  const years = wholeYearsBetween(dateOfBirth, collectedLocalDate);
  if (years < 40) return 'age18To39';
  if (years < 60) return 'age40To59';
  return 'age60Plus';
}

export function flagFor(value: string, range: RangeRow): Flag {
  const reading = new Decimal(value);
  if (
    reading.greaterThanOrEqualTo(new Decimal(range.optimalLow)) &&
    reading.lessThanOrEqualTo(new Decimal(range.optimalHigh))
  ) {
    return 'optimal';
  }
  if (
    reading.greaterThanOrEqualTo(new Decimal(range.low)) &&
    reading.lessThanOrEqualTo(new Decimal(range.high))
  ) {
    return 'inRange';
  }
  return reading.lessThan(new Decimal(range.low)) ? 'belowRange' : 'aboveRange';
}
