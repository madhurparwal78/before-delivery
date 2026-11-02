import {
  CRATE_SIZE,
  type Cadence,
  type FlavourSlug,
  type ProvinceCode,
  type TaxLineDef,
  FLAVOURS,
  findFlavour,
} from './catalogue.js';
import { allocateByLargestRemainder, formatCents, roundHalfUp, taxOn } from './money.js';

const SUBSCRIBE_DISCOUNT_PERCENT = 10;

export interface ProvinceRates {
  readonly code: ProvinceCode;
  readonly name: string;
  readonly taxes: readonly TaxLineDef[];
  readonly depositCentsPerCan: number;
  readonly shippingCents: number;
  readonly freeShippingThresholdCents: number;
}

export interface Pricing {
  readonly provinces: Readonly<Record<ProvinceCode, ProvinceRates>>;
  readonly canPriceCents: Readonly<Record<FlavourSlug, number>>;
}

export interface CanCount {
  readonly flavour: FlavourSlug;
  readonly quantity: number;
}

export interface QuoteLine {
  flavour: FlavourSlug;
  quantity: number;
  unit_price_cents: number;
  goods_cents: number;
  discount_cents: number;
  deposit_cents: number;
}

export interface QuoteTax {
  name: string;
  rate: string;
  cents: number;
}

export interface FreeShipping {
  threshold_cents: number;
  remaining_cents: number;
  progress_percent: number;
}

export interface Quote {
  province: ProvinceCode;
  subscribe: boolean;
  lines: QuoteLine[];
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  taxes: QuoteTax[];
  total_cents: number;
  free_shipping: FreeShipping;
}

/** Collapses cans into one line per flavour, ordered by flavour in seed order. */
function toCanCounts(cans: readonly CanCount[]): CanCount[] {
  const byFlavour = new Map<FlavourSlug, number>();
  for (const can of cans) {
    byFlavour.set(can.flavour, (byFlavour.get(can.flavour) ?? 0) + can.quantity);
  }
  return FLAVOURS.filter((flavour) => byFlavour.has(flavour.slug)).map((flavour) => ({
    flavour: flavour.slug,
    quantity: byFlavour.get(flavour.slug)!,
  }));
}

/**
 * The one place the quote arithmetic lives: goods, discount, discounted goods,
 * deposit, shipping, tax and total, in the order set out in the business rules.
 */
export function buildQuote(
  pricing: Pricing,
  input: { province: ProvinceCode; subscribe: boolean; cans: readonly CanCount[] },
): Quote {
  const province = pricing.provinces[input.province];
  const counts = toCanCounts(input.cans);

  const lines: QuoteLine[] = counts.map((count) => {
    const unitPriceCents = pricing.canPriceCents[count.flavour];
    return {
      flavour: count.flavour,
      quantity: count.quantity,
      unit_price_cents: unitPriceCents,
      goods_cents: unitPriceCents * count.quantity,
      discount_cents: 0,
      deposit_cents: province.depositCentsPerCan * count.quantity,
    };
  });

  const goodsCents = lines.reduce((sum, line) => sum + line.goods_cents, 0);
  const discountCents = input.subscribe
    ? roundHalfUp(goodsCents * SUBSCRIBE_DISCOUNT_PERCENT, 100)
    : 0;
  const perLineDiscount = allocateByLargestRemainder(
    discountCents,
    lines.map((line) => line.goods_cents),
  );
  lines.forEach((line, index) => {
    line.discount_cents = perLineDiscount[index]!;
  });

  const discountedGoodsCents = goodsCents - discountCents;
  const depositCents = lines.reduce((sum, line) => sum + line.deposit_cents, 0);
  const canCount = counts.reduce((sum, count) => sum + count.quantity, 0);

  const shippingCents =
    canCount === 0 || discountedGoodsCents >= province.freeShippingThresholdCents
      ? 0
      : province.shippingCents;

  const taxBaseCents = discountedGoodsCents + shippingCents;
  const taxes: QuoteTax[] = province.taxes.map((tax) => ({
    name: tax.name,
    rate: tax.rate,
    cents: taxOn(taxBaseCents, tax.rate),
  }));

  const totalCents =
    discountedGoodsCents +
    shippingCents +
    depositCents +
    taxes.reduce((sum, tax) => sum + tax.cents, 0);

  return {
    province: province.code,
    subscribe: input.subscribe,
    lines,
    goods_cents: goodsCents,
    discount_cents: discountCents,
    discounted_goods_cents: discountedGoodsCents,
    shipping_cents: shippingCents,
    deposit_cents: depositCents,
    taxes,
    total_cents: totalCents,
    free_shipping: freeShippingFigures(discountedGoodsCents, province.freeShippingThresholdCents),
  };
}

function freeShippingFigures(
  discountedGoodsCents: number,
  thresholdCents: number,
): FreeShipping {
  if (thresholdCents === 0) {
    return { threshold_cents: 0, remaining_cents: 0, progress_percent: 100 };
  }
  return {
    threshold_cents: thresholdCents,
    remaining_cents: Math.max(0, thresholdCents - discountedGoodsCents),
    progress_percent: Math.floor(
      (Math.min(discountedGoodsCents, thresholdCents) * 100) / thresholdCents,
    ),
  };
}

/** `GST (5%)` and `QST (9.975%)`: trailing zeros are dropped from the rate. */
export function taxLineLabel(name: string, rate: string): string {
  return `${name} (${rate.replace(/0+$/, '').replace(/\.$/, '')}%)`;
}

/** The free-shipping phrase used by the meter's value text and the crate announcements. */
export function shippingPhrase(quote: Quote, provinceDisplayName: string): string {
  return quote.free_shipping.remaining_cents === 0
    ? `Free shipping unlocked in ${provinceDisplayName}.`
    : `$${formatCents(quote.free_shipping.remaining_cents)} to free shipping in ${provinceDisplayName}.`;
}

/** Subscribe-and-save needs 12 cans of regular flavours: 12 of one or 4 of each of the three. */
export function subscriptionShape(cans: readonly CanCount[]): 'single' | 'discovery' | null {
  const counts = toCanCounts(cans);
  const total = counts.reduce((sum, count) => sum + count.quantity, 0);
  if (total !== CRATE_SIZE) return null;
  if (counts.some((count) => findFlavour(count.flavour)?.subscribable !== true)) return null;
  if (counts.length === 1) return 'single';
  if (counts.length === 3 && counts.every((count) => count.quantity === 4)) return 'discovery';
  return null;
}

export function isSubscribable(cans: readonly CanCount[]): boolean {
  return subscriptionShape(cans) !== null;
}

/** The plan name an eligible crate maps to at the chosen delivery rhythm. */
export function planForCrate(cans: readonly CanCount[], cadence: Cadence): string | null {
  const shape = subscriptionShape(cans);
  if (shape === null) return null;
  const suffix = cadence === 'monthly' ? 'monthly' : 'bimonthly';
  if (shape === 'discovery') return `ceibo-discovery-${suffix}`;
  const counts = toCanCounts(cans);
  return `ceibo-${counts[0]!.flavour}-${suffix}`;
}

