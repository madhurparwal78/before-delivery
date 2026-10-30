import { addMonths, dayNumber, zonedDate } from '../tz.js';
import { BATTERY_WARRANTY_MONTHS, type CountryRule } from './countries.js';

export interface WarrantyDates {
  startsOn: string;
  boardEndsOn: string;
  batteryEndsOn: string;
}

/** Warranty runs from the delivery date read in the order country's zone. */
export function warrantyDates(country: CountryRule, deliveredAt: Date): WarrantyDates {
  const startsOn = zonedDate(deliveredAt, country.warrantyTimezone);
  return {
    startsOn,
    boardEndsOn: addMonths(startsOn, country.boardWarrantyMonths),
    batteryEndsOn: addMonths(startsOn, BATTERY_WARRANTY_MONTHS),
  };
}

export function daysLeft(endsOn: string, country: CountryRule, at: Date): number {
  return Math.max(0, dayNumber(endsOn) - dayNumber(zonedDate(at, country.warrantyTimezone)));
}
