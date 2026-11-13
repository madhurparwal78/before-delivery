import type { Cadence } from "./enums.js";
import { dec, roundHalfUp } from "./money.js";

export const PLUS_SIX_MONTHS_CENTS = 74995;
export const PLUS_MONTHS: Record<Cadence, number> = { sixMonths: 6, yearly: 12 };
export const YEARLY_DISCOUNT_PERCENT = "15";

/**
 * Derive each Plus price exactly as the Business rules publish it.
 * This is the one place price derivation lives.
 */
export function plusPriceCents(cadence: Cadence): { amountCents: number; perMonthCents: number } {
  if (cadence === "sixMonths") {
    return {
      amountCents: PLUS_SIX_MONTHS_CENTS,
      perMonthCents: perMonthFor(PLUS_SIX_MONTHS_CENTS, 6),
    };
  }
  const twoPayments = dec(PLUS_SIX_MONTHS_CENTS).times(dec(2));
  const discounted = twoPayments.times(dec(85)).dividedBy(dec(100));
  const amountCents = roundHalfUp(discounted, 0).toNumber();
  return { amountCents, perMonthCents: perMonthFor(amountCents, 12) };
}

function perMonthFor(amountCents: number, months: number): number {
  return roundHalfUp(dec(amountCents).dividedBy(dec(months)), 0).toNumber();
}

export type PlanPublic = {
  id: string;
  name: string;
  prices: { cadence: Cadence; months: number; amountCents: number; perMonthCents: number }[];
};

export function publicPlans(): PlanPublic[] {
  return [
    { id: "free", name: "Free", prices: [] },
    {
      id: "plus",
      name: "Plus",
      prices: (["sixMonths", "yearly"] as Cadence[]).map((cadence) => ({
        cadence,
        months: PLUS_MONTHS[cadence],
        amountCents: plusPriceCents(cadence).amountCents,
        perMonthCents: plusPriceCents(cadence).perMonthCents,
      })),
    },
  ];
}

