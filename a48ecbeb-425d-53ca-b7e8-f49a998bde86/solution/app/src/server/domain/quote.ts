import { query } from "../db.js";
import { allocate, RATE_DENOMINATOR, rateLabel, roundHalfUp } from "./money.js";

interface Flavour {
  slug: string;
  name: string;
  position: number;
  canPriceCents: number;
  limited: boolean;
  released: number | null;
}

interface TaxRule {
  name: string;
  rateMilli: number;
}

interface Province {
  code: string;
  name: string;
  depositCentsPerCan: number;
  shippingCents: number;
  freeShippingThresholdCents: number;
  postalLetters: string;
  taxes: TaxRule[];
}

interface Pricing {
  flavours: Flavour[];
  provinces: Province[];
}

export interface CanCount {
  flavour: string;
  quantity: number;
}

export interface QuoteLine {
  flavour: string;
  quantity: number;
  unitPriceCents: number;
  goodsCents: number;
  discountCents: number;
  depositCents: number;
}

export interface QuoteTax {
  name: string;
  rateMilli: number;
  cents: number;
}

export interface Quote {
  province: string;
  subscribe: boolean;
  lines: QuoteLine[];
  goodsCents: number;
  discountCents: number;
  discountedGoodsCents: number;
  shippingCents: number;
  depositCents: number;
  taxes: QuoteTax[];
  totalCents: number;
  thresholdCents: number;
}

const DISCOUNT_PERCENT = 10;

export async function loadPricing(): Promise<Pricing> {
  const [flavours, provinces, taxes] = await Promise.all([
    query<{ slug: string; name: string; position: number; can_price_cents: number; limited: boolean; released: number | null }>(
      "SELECT slug, name, position, can_price_cents, limited, released FROM flavours ORDER BY position",
    ),
    query<{
      code: string;
      name: string;
      deposit_cents_per_can: number;
      shipping_cents: number;
      free_shipping_threshold_cents: number;
      postal_letters: string;
    }>("SELECT * FROM provinces ORDER BY position"),
    query<{ province: string; name: string; rate_milli: number }>(
      "SELECT province, name, rate_milli FROM province_taxes ORDER BY province, position",
    ),
  ]);
  return {
    flavours: flavours.map((f) => ({
      slug: f.slug,
      name: f.name,
      position: f.position,
      canPriceCents: f.can_price_cents,
      limited: f.limited,
      released: f.released,
    })),
    provinces: provinces.map((p) => ({
      code: p.code,
      name: p.name,
      depositCentsPerCan: p.deposit_cents_per_can,
      shippingCents: p.shipping_cents,
      freeShippingThresholdCents: p.free_shipping_threshold_cents,
      postalLetters: p.postal_letters,
      taxes: taxes.filter((t) => t.province === p.code).map((t) => ({ name: t.name, rateMilli: t.rate_milli })),
    })),
  };
}

/**
 * The quote, built in the brief's seven steps. Callers pass a known province and known
 * flavours; the route validates input first.
 */
export function buildQuote(pricing: Pricing, provinceCode: string, subscribe: boolean, cans: CanCount[]): Quote {
  const province = pricing.provinces.find((p) => p.code === provinceCode);
  if (!province) throw new Error(`unknown province ${provinceCode}`);
  const counts = new Map<string, number>();
  for (const can of cans) counts.set(can.flavour, (counts.get(can.flavour) ?? 0) + can.quantity);
  const ordered = pricing.flavours.filter((f) => (counts.get(f.slug) ?? 0) > 0);

  const goods = ordered.map((f) => (counts.get(f.slug) ?? 0) * f.canPriceCents);
  const goodsCents = goods.reduce((a, b) => a + b, 0);
  const discountCents = subscribe ? roundHalfUp(goodsCents * DISCOUNT_PERCENT, 100) : 0;
  const lineDiscounts = allocate(discountCents, goods);
  const discountedGoodsCents = goodsCents - discountCents;

  const lines: QuoteLine[] = ordered.map((f, i) => {
    const quantity = counts.get(f.slug) ?? 0;
    return {
      flavour: f.slug,
      quantity,
      unitPriceCents: f.canPriceCents,
      goodsCents: goods[i],
      discountCents: lineDiscounts[i],
      depositCents: quantity * province.depositCentsPerCan,
    };
  });
  const depositCents = lines.reduce((a, l) => a + l.depositCents, 0);
  const shippingCents =
    lines.length === 0 || discountedGoodsCents >= province.freeShippingThresholdCents ? 0 : province.shippingCents;
  const taxBase = discountedGoodsCents + shippingCents;
  const taxes = province.taxes.map((t) => ({
    name: t.name,
    rateMilli: t.rateMilli,
    cents: roundHalfUp(taxBase * t.rateMilli, RATE_DENOMINATOR),
  }));
  const totalCents = discountedGoodsCents + shippingCents + depositCents + taxes.reduce((a, t) => a + t.cents, 0);
  return {
    province: province.code,
    subscribe,
    lines,
    goodsCents,
    discountCents,
    discountedGoodsCents,
    shippingCents,
    depositCents,
    taxes,
    totalCents,
    thresholdCents: province.freeShippingThresholdCents,
  };
}

interface FreeShipping {
  threshold_cents: number;
  remaining_cents: number;
  progress_percent: number;
}

function freeShipping(discountedGoodsCents: number, thresholdCents: number): FreeShipping {
  return {
    threshold_cents: thresholdCents,
    remaining_cents: Math.max(0, thresholdCents - discountedGoodsCents),
    progress_percent:
      thresholdCents === 0 ? 100 : Math.floor((Math.min(discountedGoodsCents, thresholdCents) * 100) / thresholdCents),
  };
}

export function quoteJson(q: Quote) {
  return {
    province: q.province,
    subscribe: q.subscribe,
    lines: q.lines.map((l) => ({
      flavour: l.flavour,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      goods_cents: l.goodsCents,
      discount_cents: l.discountCents,
      deposit_cents: l.depositCents,
    })),
    goods_cents: q.goodsCents,
    discount_cents: q.discountCents,
    discounted_goods_cents: q.discountedGoodsCents,
    shipping_cents: q.shippingCents,
    deposit_cents: q.depositCents,
    taxes: q.taxes.map((t) => ({ name: t.name, rate: rateLabel(t.rateMilli), cents: t.cents })),
    total_cents: q.totalCents,
    free_shipping: { ...freeShipping(q.discountedGoodsCents, q.thresholdCents) },
  };
}
