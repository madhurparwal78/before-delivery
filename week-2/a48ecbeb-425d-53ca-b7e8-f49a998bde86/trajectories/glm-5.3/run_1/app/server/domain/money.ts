/** Integer-cent money math with half-up rounding and largest-remainder allocation. */

export function halfUp(numerator: number, denominator: number): number {
  // Rounds numerator/denominator half up to the nearest integer. Integers only in and out.
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const base = Math.floor((2 * n + d) / (2 * d));
  return sign * base;
}

export interface Part {
  index: number;
  value: number;
}

/** Splits `amount` across parts proportional to their values, whole units only, largest remainder wins ties by earlier index. */
export function largestRemainder(amount: number, parts: Part[]): number[] {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const out = new Array<number>(parts.length).fill(0);
  if (total <= 0 || amount <= 0) return out;
  let allocated = 0;
  const fractions: { index: number; frac: number }[] = [];
  parts.forEach((p, i) => {
    const share = (amount * p.value) / total;
    const whole = Math.floor(share);
    out[i] = whole;
    allocated += whole;
    fractions.push({ index: i, frac: share - whole });
  });
  let leftover = amount - allocated;
  fractions.sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const f of fractions) {
    if (leftover <= 0) break;
    out[f.index] += 1;
    leftover -= 1;
  }
  return out;
}

export interface QuoteLine {
  flavour: string;
  quantity: number;
  unit_price_cents: number;
  goods_cents: number;
  discount_cents: number;
  deposit_cents: number;
}

export interface TaxLine {
  name: string;
  rate: string;
  cents: number;
}

export interface Quote {
  province: string;
  subscribe: boolean;
  lines: QuoteLine[];
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  taxes: TaxLine[];
  total_cents: number;
  free_shipping: {
    threshold_cents: number;
    remaining_cents: number;
    progress_percent: number;
  };
}

export interface ProvinceTax {
  name: string;
  rate_milli: number;
}

export interface ProvincePricing {
  shipping_cents: number;
  free_shipping_threshold_cents: number;
  deposit_cents_per_can: number;
  taxes: ProvinceTax[];
}

export interface QuoteInput {
  province: string;
  subscribe: boolean;
  lines: { flavour: string; quantity: number; unit_price_cents: number }[];
  pricing: ProvincePricing;
}

const SUBSCRIBE_RATE_MILLI = 100;

export function buildQuote(input: QuoteInput): Quote {
  const lines: QuoteLine[] = input.lines.map((l) => ({
    flavour: l.flavour,
    quantity: l.quantity,
    unit_price_cents: l.unit_price_cents,
    goods_cents: l.quantity * l.unit_price_cents,
    discount_cents: 0,
    deposit_cents: l.quantity * input.pricing.deposit_cents_per_can,
  }));
  const goods = lines.reduce((s, l) => s + l.goods_cents, 0);

  let discount = 0;
  if (input.subscribe && goods > 0) {
    discount = halfUp(goods * SUBSCRIBE_RATE_MILLI, 1000);
    const shares = largestRemainder(
      discount,
      lines.map((l) => ({ index: 0, value: l.goods_cents }))
    );
    lines.forEach((l, i) => {
      l.discount_cents = shares[i];
    });
  }
  const discountedGoods = goods - discount;
  const threshold = input.pricing.free_shipping_threshold_cents;
  const shipping =
    goods === 0 || discountedGoods >= threshold ? 0 : input.pricing.shipping_cents;
  const deposit = lines.reduce((s, l) => s + l.deposit_cents, 0);
  const taxes: TaxLine[] = input.pricing.taxes.map((t) => ({
    name: t.name,
    rate: (t.rate_milli / 1000).toFixed(3),
    cents: halfUp((discountedGoods + shipping) * t.rate_milli, 100_000),
  }));
  const total = discountedGoods + shipping + deposit + taxes.reduce((s, t) => s + t.cents, 0);
  const remaining = Math.max(0, threshold - discountedGoods);
  const progress =
    threshold === 0 ? 100 : Math.floor((Math.min(discountedGoods, threshold) * 100) / threshold);
  return {
    province: input.province,
    subscribe: input.subscribe,
    lines,
    goods_cents: goods,
    discount_cents: discount,
    discounted_goods_cents: discountedGoods,
    shipping_cents: shipping,
    deposit_cents: deposit,
    taxes,
    total_cents: total,
    free_shipping: {
      threshold_cents: threshold,
      remaining_cents: remaining,
      progress_percent: progress,
    },
  };
}

export function shippingPhrase(remainingCents: number, provinceName: string): string {
  if (remainingCents <= 0) return `Free shipping unlocked in ${provinceName}.`;
  return `$${(remainingCents / 100).toFixed(2)} to free shipping in ${provinceName}.`;
}
