import { addDays, weekday, zonedParts } from '../tz.js';
import { WAREHOUSE_HOLIDAYS, WAREHOUSE_TIMEZONE, type CountryRule } from './countries.js';

const SHIP_CUTOFF_HOUR = 14;

function isBusinessDay(date: string, warehouse: CountryRule['warehouse']): boolean {
  const day = weekday(date);
  if (day === 0 || day === 6) return false;
  return !WAREHOUSE_HOLIDAYS[warehouse].includes(date);
}

function nextBusinessDay(date: string, warehouse: CountryRule['warehouse']): string {
  let next = addDays(date, 1);
  while (!isBusinessDay(next, warehouse)) next = addDays(next, 1);
  return next;
}

/** The ship-by date and arrival date for a country, read from the warehouse's 14:00 cut-off. */
export function deliveryDates(country: CountryRule, at: Date): { ships_on: string; arrives_on: string } {
  const timezone = WAREHOUSE_TIMEZONE[country.warehouse];
  const local = zonedParts(at, timezone);
  const today = `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  const shipsOn =
    isBusinessDay(today, country.warehouse) && local.hour < SHIP_CUTOFF_HOUR
      ? today
      : nextBusinessDay(today, country.warehouse);

  let arrivesOn = shipsOn;
  for (let i = 0; i < country.transitBusinessDays; i += 1) arrivesOn = nextBusinessDay(arrivesOn, country.warehouse);

  return { ships_on: shipsOn, arrives_on: arrivesOn };
}
