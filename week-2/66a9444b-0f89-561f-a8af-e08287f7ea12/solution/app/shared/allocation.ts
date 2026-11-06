// The published price rule: group discount (policy percent of the subtotal, half up), then the voucher
// (the smaller of its balance and what is left), each spread across lines by the largest-remainder rule.
// The server prices every order with it; checkout's review step shows the same figures.

/**
 * Spreads `total` whole cents in proportion to `weights`: every line takes the whole-cent part of its exact
 * share, the cents left over go one at a time to the largest dropped fractions, ties to the earlier position.
 */
function allocate(total: number, weights: readonly number[]): number[] {
  const whole = weights.reduce((sum, w) => sum + w, 0);
  if (total === 0 || whole === 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor((total * w) / whole));
  const remainders = weights.map((w) => (total * w) % whole);
  let left = total - shares.reduce((sum, s) => sum + s, 0);
  const order = weights.map((_, i) => i).sort((a, b) => remainders[b]! - remainders[a]! || a - b);
  for (const i of order) {
    if (left === 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

/** Policy percent of the subtotal, rounded half up to the cent. */
function groupDiscount(subtotal: number, percent: number): number {
  return Math.floor((subtotal * percent + 50) / 100);
}

type PricedLine = { list_cents: number; group_discount_cents: number; voucher_cents: number; charged_cents: number };
type PricedOrder = {
  lines: PricedLine[];
  subtotal_cents: number;
  group_discount_cents: number;
  voucher_cents: number;
  total_cents: number;
};

/** Prices lines given in position order. `groupPercent` is null for visitor orders. */
export function priceOrder(listPrices: readonly number[], groupPercent: number | null, voucherBalance: number): PricedOrder {
  const subtotal = listPrices.reduce((sum, p) => sum + p, 0);
  const discount = groupPercent === null ? 0 : groupDiscount(subtotal, groupPercent);
  const discounts = allocate(discount, listPrices);
  const afterDiscount = listPrices.map((p, i) => p - discounts[i]!);
  const voucher = Math.min(Math.max(voucherBalance, 0), subtotal - discount);
  const vouchers = allocate(voucher, afterDiscount);
  const lines = listPrices.map((p, i) => ({
    list_cents: p,
    group_discount_cents: discounts[i]!,
    voucher_cents: vouchers[i]!,
    charged_cents: afterDiscount[i]! - vouchers[i]!,
  }));
  return { lines, subtotal_cents: subtotal, group_discount_cents: discount, voucher_cents: voucher, total_cents: subtotal - discount - voucher };
}
