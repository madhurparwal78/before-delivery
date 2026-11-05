// Quotes: equity, discount tier, payoff, sales tax and total for any month
// from 0 to the term length (DP-18, DP-24).
import type { Tier, Quote } from "../../shared/domain.js";
import { roundDiv } from "./money.js";
import { toTier, tierForMonth, type PriceItemRow, type TierRow } from "./priceLists.js";

export interface QuoteInputs {
  contractId: string;
  equity: number;
  contractMonth: number;
  item: PriceItemRow;
  tiers: TierRow[];
  taxRateBp: number;
  today: string;
}

export function quoteForMonth(inputs: QuoteInputs, month: number): Quote {
  const { contractId, equity, contractMonth, item, tiers, taxRateBp, today } = inputs;
  const termMonths = Math.ceil(item.purchase_price_cents / item.base_rent_cents);
  const b = item.base_rent_cents;
  const P = item.purchase_price_cents;
  const m = contractMonth;
  let equityAt: number;
  if (month < m) {
    equityAt = month * b;
  } else {
    equityAt = Math.min(P, equity + (month - m) * b);
  }
  const remaining = P - equityAt;
  const tier = tierForMonth(tiers, month);
  const discount = roundDiv(remaining * tier.percent, 100);
  const payoff = remaining - discount;
  const tax = roundDiv(payoff * taxRateBp, 10000);
  const total = payoff + tax;
  return {
    contract_id: contractId,
    month,
    term_months: termMonths,
    paid: month <= m,
    equity_cents: equityAt,
    remaining_cents: remaining,
    tier: { label: tierLabelOf(tier), percent: tier.percent },
    discount_cents: discount,
    payoff_cents: payoff,
    tax_cents: tax,
    total_cents: total,
    valid_until: addDays(today, 7),
  };
}

export function tierLabelOf(tier: TierRow): string {
  return `${tier.name}, ${tier.percent}% off remaining`;
}

export function tierOf(tierRow: TierRow): Tier {
  return toTier(tierRow);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const shifted = new Date(utc + days * 86400000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}
