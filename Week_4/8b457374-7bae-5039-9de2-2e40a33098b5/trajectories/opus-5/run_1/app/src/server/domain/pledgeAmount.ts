import type { Zone } from '../../shared/countries.js';

export interface TierPricing {
  readonly price: number;
  readonly shipping: {
    readonly domestic: number;
    readonly europe: number;
    readonly rest_of_world: number;
  };
}

export interface PledgeBreakdown {
  readonly reward: number;
  readonly shipping: number;
  readonly add_on: number;
  readonly amount: number;
}

/**
 * The one place the pledge amount rule lives: tier price plus the tier's shipping
 * for the backer's zone plus the add-on, all in pence.
 */
export function breakdownFor(tier: TierPricing, zone: Zone, addOn: number): PledgeBreakdown {
  const reward = tier.price;
  const shipping = tier.shipping[zone];
  return { reward, shipping, add_on: addOn, amount: reward + shipping + addOn };
}

/** `percent` = floor(100 x total / goal). */
export function percentOf(total: number, goal: number): number {
  return Math.floor((100 * total) / goal);
}
