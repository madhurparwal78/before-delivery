import type { ShippingMethod, Totals } from "../shared/api";
import { config } from "./config";
import { roundHalfUp } from "./money";

// The totals calculation, in the one published order. Whole rupees throughout.

const SHIPPING_FEE: Record<ShippingMethod, number> = { standard: 249, express: 499 };

export interface PricedLine {
  id: string;
  unitPrice: number;
  quantity: number;
  /** Collection slug the line belongs to. */
  category: string;
}

export interface DiscountRule {
  kind: "percent" | "fixed";
  value: number;
  /** Null: every line. */
  collection: string | null;
}

interface LineAmounts {
  id: string;
  subtotal: number;
  discount: number;
  tax: number;
}

interface Computed {
  lines: LineAmounts[];
  shippingTax: number;
  /** Subtotal, discount, shipping, tax and total before any gift card. */
  grand: number;
  totals: Totals;
}

export function eligible(rule: DiscountRule | null, line: PricedLine): boolean {
  return rule !== null && (rule.collection === null || rule.collection === line.category);
}

/** Per-line discounts: percentage rounds each line half up; a fixed amount is shared by line subtotal, remainders in bag order. */
function allocateDiscount(lines: PricedLine[], rule: DiscountRule | null): number[] {
  const subtotals = lines.map((l) => l.unitPrice * l.quantity);
  if (!rule) return subtotals.map(() => 0);
  const pool = subtotals.reduce((sum, s, i) => sum + (lines[i] && eligible(rule, lines[i]) ? s : 0), 0);
  if (rule.kind === "percent") {
    return subtotals.map((s, i) => (lines[i] && eligible(rule, lines[i]) ? roundHalfUp(s * rule.value, 100) : 0));
  }
  const amount = Math.min(rule.value, pool);
  const shares = subtotals.map((s, i) => (lines[i] && eligible(rule, lines[i]) && pool > 0 ? Math.floor((amount * s) / pool) : 0));
  let leftover = amount - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; leftover > 0 && i < lines.length; i = (i + 1) % lines.length) {
    const line = lines[i];
    if (line && eligible(rule, line)) {
      shares[i] = (shares[i] ?? 0) + 1;
      leftover -= 1;
    }
  }
  return shares;
}

export function compute(lines: PricedLine[], rule: DiscountRule | null, method: ShippingMethod, giftBalance: number): Computed {
  const discounts = allocateDiscount(lines, rule);
  const amounts: LineAmounts[] = lines.map((line, i) => {
    const subtotal = line.unitPrice * line.quantity;
    const discount = discounts[i] ?? 0;
    return { id: line.id, subtotal, discount, tax: roundHalfUp((subtotal - discount) * config.taxRatePercent, 100) };
  });
  const subtotal = amounts.reduce((sum, a) => sum + a.subtotal, 0);
  const discount = amounts.reduce((sum, a) => sum + a.discount, 0);
  const discounted = subtotal - discount;
  const shipping = lines.length === 0 ? 0 : method === "express" ? SHIPPING_FEE.express : discounted >= config.freeShippingMinimum ? 0 : SHIPPING_FEE.standard;
  const shippingTax = roundHalfUp(shipping * config.taxRatePercent, 100);
  const tax = amounts.reduce((sum, a) => sum + a.tax, 0) + shippingTax;
  const grand = discounted + shipping + tax;
  const giftCard = Math.min(giftBalance, grand);
  return { lines: amounts, shippingTax, grand, totals: { subtotal, discount, shipping, tax, gift_card: giftCard, total: grand - giftCard } };
}
