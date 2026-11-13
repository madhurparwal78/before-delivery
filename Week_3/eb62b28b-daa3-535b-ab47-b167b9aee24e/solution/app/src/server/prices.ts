// The published Plus prices. Free costs nothing and has no Kill Bill subscription.

import type { Cadence } from "../shared/api";
import { centsPerMonth, percentOfCents } from "./decimal";

const SIX_MONTHS_CENTS = 74995;
const YEARLY_PERCENT = 85;

export const PLUS_CENTS: Readonly<Record<Cadence, number>> = {
  sixMonths: SIX_MONTHS_CENTS,
  yearly: percentOfCents(SIX_MONTHS_CENTS * 2, YEARLY_PERCENT),
};

export function planPrices(): { cadence: Cadence; months: number; amountCents: number; perMonthCents: number }[] {
  return [
    { cadence: "sixMonths", months: 6, amountCents: PLUS_CENTS.sixMonths, perMonthCents: centsPerMonth(PLUS_CENTS.sixMonths, 6) },
    { cadence: "yearly", months: 12, amountCents: PLUS_CENTS.yearly, perMonthCents: centsPerMonth(PLUS_CENTS.yearly, 12) },
  ];
}
