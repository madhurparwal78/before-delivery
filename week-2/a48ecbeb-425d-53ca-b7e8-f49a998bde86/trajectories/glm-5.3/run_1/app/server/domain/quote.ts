import { withClient, type DbClient } from '../db.js';
import { buildQuote, type Quote, type ProvincePricing } from './money.js';
import { FLAVOUR_ORDER } from './catalogue.js';

export interface ProvinceRow {
  code: string;
  name: string;
  shipping_cents: number;
  free_shipping_threshold_cents: number;
  deposit_cents_per_can: number;
  taxes: { name: string; rate_milli: number; sort: number }[];
}

export const PROVINCE_ORDER = ['AB', 'BC', 'NS', 'ON', 'QC'];

export async function loadProvinces(client?: DbClient): Promise<ProvinceRow[]> {
  const c = client ?? (await withClient(async (x) => x));
  const provinces = (await c.query(
    'select code, name, shipping_cents, free_shipping_threshold_cents, deposit_cents_per_can from provinces order by array_position($1::text[], code)',
    [PROVINCE_ORDER]
  )).rows as Omit<ProvinceRow, 'taxes'>[];
  const taxes = (await c.query('select code, name, rate_milli, sort from province_taxes order by code, sort')).rows;
  return provinces.map((p) => ({
    ...p,
    taxes: taxes.filter((t) => t.code === p.code).map((t: { name: string; rate_milli: number; sort: number }) => ({ name: t.name, rate_milli: t.rate_milli, sort: t.sort })),
  }));
}

export function pricingOf(province: ProvinceRow): ProvincePricing {
  return {
    shipping_cents: province.shipping_cents,
    free_shipping_threshold_cents: province.free_shipping_threshold_cents,
    deposit_cents_per_can: province.deposit_cents_per_can,
    taxes: province.taxes.map((t) => ({ name: t.name, rate_milli: t.rate_milli })),
  };
}

export interface QuoteRequest {
  province: string;
  subscribe: boolean;
  cans: { flavour: string; quantity: number }[];
}

export async function quoteFor(client: DbClient, request: QuoteRequest): Promise<Quote> {
  const provinces = await loadProvinces(client);
  const province = provinces.find((p) => p.code === request.province);
  if (!province) throw new QuoteValidationError('province', "We don't ship to that province yet.");
  const flavourRows = (await client.query(
    'select slug, name, can_price_cents, limited, subscribable from flavours order by array_position($1::text[], slug)',
    [FLAVOUR_ORDER]
  )).rows as { slug: string; name: string; can_price_cents: number; limited: boolean; subscribable: boolean }[];
  const bySlug = new Map(flavourRows.map((f) => [f.slug, f]));
  const lines: { flavour: string; quantity: number; unit_price_cents: number }[] = [];
  let total = 0;
  for (const can of request.cans) {
    const f = bySlug.get(can.flavour);
    if (!f) throw new QuoteValidationError('cans', 'Pick from the listed flavours.');
    if (!Number.isInteger(can.quantity) || can.quantity < 1) {
      throw new QuoteValidationError('cans', 'Pick at least one can of each flavour.');
    }
    total += can.quantity;
    const existing = lines.find((l) => l.flavour === can.flavour);
    if (existing) existing.quantity += can.quantity;
    else lines.push({ flavour: can.flavour, quantity: can.quantity, unit_price_cents: f.can_price_cents });
  }
  if (total > 12) throw new QuoteValidationError('cans', 'A crate holds up to 12 cans.');
  if (request.subscribe) {
    for (const line of lines) {
      const f = bySlug.get(line.flavour)!;
      if (f.limited || !f.subscribable) {
        throw new QuoteValidationError('subscribe', "Limited drops can't be added to a subscription.");
      }
    }
  }
  const ordered = FLAVOUR_ORDER.map((slug) => lines.find((l) => l.flavour === slug)).filter(
    (l): l is { flavour: string; quantity: number; unit_price_cents: number } => l !== undefined
  );
  return buildQuote({
    province: request.province,
    subscribe: request.subscribe,
    lines: ordered,
    pricing: pricingOf(province),
  });
}

export class QuoteValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}
