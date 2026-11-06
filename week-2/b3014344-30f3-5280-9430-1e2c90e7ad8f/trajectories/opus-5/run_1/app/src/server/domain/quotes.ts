import { errors } from "../errors.js";
import { studioInstant } from "../time.js";
import { type Currency, type Money, depositMinor, money, sharePercent, toAmountString } from "../../shared/money.js";
import { type PlanId, isCarePlan } from "../../shared/plans.js";
import { priceInEffect, type PriceRow } from "./prices.js";

export interface Quote {
  plan: PlanId;
  currency: Currency;
  total: Money;
  dueNow: Money;
  dueAtLaunch: Money;
  priceRow: PriceRow;
}

/** The one place the build split and the care-plan first month are decided. */
export function quoteFromPrice(plan: PlanId, priceRow: PriceRow): Quote {
  const total = priceRow.amount;
  if (isCarePlan(plan)) {
    return {
      plan,
      currency: total.currency,
      total,
      dueNow: total,
      dueAtLaunch: money(total.currency, 0n),
      priceRow,
    };
  }
  const deposit = depositMinor(total.minor);
  return {
    plan,
    currency: total.currency,
    total,
    dueNow: money(total.currency, deposit),
    dueAtLaunch: money(total.currency, total.minor - deposit),
    priceRow,
  };
}

export async function quoteAt(plan: PlanId, currency: Currency, at: Date): Promise<Quote> {
  const priceRow = await priceInEffect(plan, currency, at);
  if (!priceRow) throw errors.billingUnavailable();
  return quoteFromPrice(plan, priceRow);
}

export function serializeQuote(quote: Quote): Record<string, unknown> {
  return {
    plan: quote.plan,
    currency: quote.currency,
    total: toAmountString(quote.total),
    dueNow: toAmountString(quote.dueNow),
    dueAtLaunch: toAmountString(quote.dueAtLaunch),
    dueNowShare: sharePercent(quote.dueNow.minor, quote.total.minor),
    priceEffectiveAt: studioInstant(quote.priceRow.effectiveAt),
  };
}
