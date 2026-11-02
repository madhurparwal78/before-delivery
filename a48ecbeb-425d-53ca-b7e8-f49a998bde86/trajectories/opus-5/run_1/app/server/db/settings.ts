import {
  FLAVOURS,
  PROVINCES,
  type FlavourSlug,
  type ProvinceCode,
  findProvince,
} from '../../shared/catalogue.js';
import type { Pricing, ProvinceRates } from '../../shared/quote.js';
import { query } from './pool.js';

export interface ProvinceSettings extends ProvinceRates {
  depositCentsPerCan: number;
}

export interface DropSettings {
  flavour: FlavourSlug;
  canPriceCents: number;
  released: number;
}

export interface Settings {
  pricing: Pricing;
  provinces: ProvinceSettings[];
  drop: DropSettings;
}

const DROP_FLAVOUR: FlavourSlug = 'cacao-orange';

/** Reads the editable prices, shipping rates and thresholds behind every quote. */
export async function loadSettings(): Promise<Settings> {
  const [provinceRows, flavourRows] = await Promise.all([
    query<{ code: string; shipping_cents: number; free_shipping_threshold_cents: number }>(
      'select code, shipping_cents, free_shipping_threshold_cents from provinces',
    ),
    query<{ slug: string; can_price_cents: number; released: number | null }>(
      'select slug, can_price_cents, released from flavours',
    ),
  ]);

  const shipping = new Map(provinceRows.map((row) => [row.code, row]));
  const prices = new Map(flavourRows.map((row) => [row.slug, row]));

  const provinces: ProvinceSettings[] = PROVINCES.map((seed) => {
    const row = shipping.get(seed.code);
    return {
      code: seed.code,
      name: seed.name,
      taxes: seed.taxes,
      depositCentsPerCan: seed.depositCentsPerCan,
      shippingCents: row?.shipping_cents ?? seed.shippingCents,
      freeShippingThresholdCents:
        row?.free_shipping_threshold_cents ?? seed.freeShippingThresholdCents,
    };
  });

  const canPriceCents = Object.fromEntries(
    FLAVOURS.map((flavour) => [
      flavour.slug,
      prices.get(flavour.slug)?.can_price_cents ?? flavour.canPriceCents,
    ]),
  ) as Record<FlavourSlug, number>;

  return {
    pricing: {
      provinces: Object.fromEntries(
        provinces.map((province) => [province.code, province]),
      ) as Record<ProvinceCode, ProvinceRates>,
      canPriceCents,
    },
    provinces,
    drop: {
      flavour: DROP_FLAVOUR,
      canPriceCents: canPriceCents[DROP_FLAVOUR],
      released: prices.get(DROP_FLAVOUR)?.released ?? 0,
    },
  };
}

export async function saveProvinceRates(
  code: ProvinceCode,
  shippingCents: number,
  thresholdCents: number,
): Promise<ProvinceSettings> {
  await query(
    `update provinces set shipping_cents = $2, free_shipping_threshold_cents = $3 where code = $1`,
    [code, shippingCents, thresholdCents],
  );
  const seed = findProvince(code)!;
  return {
    code,
    name: seed.name,
    taxes: seed.taxes,
    depositCentsPerCan: seed.depositCentsPerCan,
    shippingCents,
    freeShippingThresholdCents: thresholdCents,
  };
}

export async function saveDropPrice(canPriceCents: number): Promise<void> {
  await query('update flavours set can_price_cents = $2 where slug = $1', [
    DROP_FLAVOUR,
    canPriceCents,
  ]);
}

export async function saveDropRelease(released: number): Promise<void> {
  await query('update flavours set released = $2 where slug = $1', [DROP_FLAVOUR, released]);
}

export { DROP_FLAVOUR };
