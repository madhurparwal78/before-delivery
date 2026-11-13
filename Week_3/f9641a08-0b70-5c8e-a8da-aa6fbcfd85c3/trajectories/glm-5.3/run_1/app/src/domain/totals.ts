import { CONFIG } from '../config.js';

/** Whole-rupee rounding, half away from zero (matches the published rule). */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

export type CartLineInput = { sku: string; product: string; collection: string; unit_price: number; quantity: number };

export type AppliedCode = { code: string; kind: 'percent' | 'fixed'; value: number; collection: string | null; minimum: number } | null;

export type LineTotals = {
  unit_price: number;
  quantity: number;
  line_subtotal: number;
  line_discount: number;
  line_tax: number;
};

export type BagTotals = {
  subtotal: number;
  discount: number;
  shipping: number;
  shipping_tax: number;
  tax: number;
  grand_total: number;
  gift_card: number;
  total: number;
};

/**
 * The one place the published totals calculation lives.
 * 1. line subtotal = unit price × quantity; subtotal = sum.
 * 2. discount on eligible lines only.
 * 3. line net = subtotal − discount.
 * 4. shipping: standard ₹0 at/above the free minimum else ₹249; express ₹499.
 * 5. tax per line on the net, shipping tax on shipping, both half-up.
 * 6. grand total = discounted subtotal + shipping + tax.
 * 7. gift card = min(balance, grand total); total = grand total − gift card.
 */
export function computeTotals(
  lines: CartLineInput[],
  code: AppliedCode,
  shippingMethod: 'standard' | 'express',
  giftCardBalance: number | null,
): { lines: LineTotals[]; totals: BagTotals } {
  const computed: LineTotals[] = lines.map((line) => ({
    unit_price: line.unit_price,
    quantity: line.quantity,
    line_subtotal: line.unit_price * line.quantity,
    line_discount: 0,
    line_tax: 0,
  }));

  let discount = 0;
  const eligibleIdx: number[] = [];
  lines.forEach((line, i) => {
    if (code && (code.collection === null || code.collection === line.collection)) eligibleIdx.push(i);
  });
  const eligibleSubtotal = eligibleIdx.reduce((sum, i) => sum + computed[i].line_subtotal, 0);

  if (code && eligibleIdx.length > 0 && eligibleSubtotal >= code.minimum) {
    if (code.kind === 'percent') {
      for (const i of eligibleIdx) {
        computed[i].line_discount = roundHalfUp((computed[i].line_subtotal * code.value) / 100);
      }
    } else {
      const capped = Math.min(code.value, eligibleSubtotal);
      let allocated = 0;
      for (const i of eligibleIdx) {
        const share = Math.floor((capped * computed[i].line_subtotal) / eligibleSubtotal);
        computed[i].line_discount = share;
        allocated += share;
      }
      let leftover = capped - allocated;
      for (const i of eligibleIdx) {
        if (leftover <= 0) break;
        computed[i].line_discount += 1;
        leftover -= 1;
      }
    }
    discount = eligibleIdx.reduce((sum, i) => sum + computed[i].line_discount, 0);
  }

  const subtotal = computed.reduce((sum, l) => sum + l.line_subtotal, 0);
  const discountedSubtotal = subtotal - discount;
  const shipping = shippingMethod === 'express'
    ? 499
    : (discountedSubtotal >= CONFIG.freeShippingMinimum ? 0 : (subtotal === 0 ? 0 : 249));
  for (const l of computed) {
    l.line_tax = roundHalfUp(((l.line_subtotal - l.line_discount) * CONFIG.taxRatePercent) / 100);
  }
  const shippingTax = shipping === 0 ? 0 : roundHalfUp((shipping * CONFIG.taxRatePercent) / 100);
  const tax = computed.reduce((sum, l) => sum + l.line_tax, 0) + shippingTax;
  const grandTotal = discountedSubtotal + shipping + tax;
  const giftCard = giftCardBalance === null ? 0 : Math.min(giftCardBalance, grandTotal);
  const total = grandTotal - giftCard;

  return {
    lines: computed,
    totals: {
      subtotal,
      discount,
      shipping,
      shipping_tax: shippingTax,
      tax,
      grand_total: grandTotal,
      gift_card: giftCard,
      total,
    },
  };
}
