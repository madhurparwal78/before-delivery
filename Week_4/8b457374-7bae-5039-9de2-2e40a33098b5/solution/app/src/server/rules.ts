import type { Fees, Shipping, Zone } from "../shared/api.js";
import { countryOf } from "../shared/countries.js";

// The brief's arithmetic, each rule in exactly one place (Business rules). Integer pence only.

/** Integer nearest num/den with halves rounded up (num, den > 0). */
function roundHalfUp(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

export function percentOf(total: number, goal: number): number {
  return Math.floor((100 * total) / goal);
}

function zoneFor(country: string, shipsFrom: string): Zone {
  if (country === shipsFrom) return "domestic";
  return countryOf(country)?.region === "europe" ? "europe" : "rest_of_world";
}

interface PledgeAmount {
  zone: Zone;
  reward: number;
  shipping: number;
  add_on: number;
  amount: number;
}

/** amount = tier price + the tier's shipping for the backer's zone + add-on. */
export function pledgeAmount(tier: { price: number; shipping: Shipping }, country: string, shipsFrom: string, addOn: number): PledgeAmount {
  const zone = zoneFor(country, shipsFrom);
  const shipping = tier.shipping[zone];
  return { zone, reward: tier.price, shipping, add_on: addOn, amount: tier.price + shipping + addOn };
}

/** Platform 5 %, processing 3 % + 20p, each rounded half up per pledge; the rest goes to the creator. */
export function fees(amount: number): Fees {
  const platform_fee = roundHalfUp(amount * 5, 100);
  const processing_fee = roundHalfUp(amount * 3, 100) + 20;
  return { platform_fee, processing_fee, to_creator: amount - platform_fee - processing_fee };
}
