import {
  CRATE_SIZE,
  type FlavourSlug,
  type ProvinceCode,
  findFlavour,
  findPlan,
  findProvince,
  provinceName,
} from '../../shared/catalogue.js';
import { apiMessages } from '../../shared/copy.js';
import { buildQuote, shippingPhrase, type CanCount, type Quote } from '../../shared/quote.js';
import { loadSettings, type Settings } from '../db/settings.js';
import { validationError } from '../http/errors.js';

export interface QuoteRequest {
  province: ProvinceCode;
  subscribe: boolean;
  cans: CanCount[];
}

/** Validates a quote request against the published field rules. */
export function readQuoteRequest(body: unknown): QuoteRequest {
  const payload = (body ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const provinceCode = typeof payload.province === 'string' ? payload.province : '';
  if (findProvince(provinceCode) === undefined) fields.province = apiMessages.unknownProvince;

  const subscribe = payload.subscribe === true;
  if (payload.subscribe !== true && payload.subscribe !== false) {
    fields.subscribe = 'Say whether this crate is a subscription.';
  }

  const cans: CanCount[] = [];
  const rawCans = payload.cans;
  if (!Array.isArray(rawCans)) {
    fields.cans = apiMessages.unknownFlavour;
  } else {
    let total = 0;
    for (const entry of rawCans) {
      const can = (entry ?? {}) as Record<string, unknown>;
      const flavour = typeof can.flavour === 'string' ? findFlavour(can.flavour) : undefined;
      const quantity = can.quantity;
      if (flavour === undefined) {
        fields.cans = apiMessages.unknownFlavour;
        continue;
      }
      if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
        fields.cans = apiMessages.badQuantity;
        continue;
      }
      total += quantity;
      cans.push({ flavour: flavour.slug, quantity });
      if (subscribe && !flavour.subscribable) {
        fields.subscribe = apiMessages.limitedNotSubscribable;
      }
    }
    if (total > CRATE_SIZE) fields.cans = apiMessages.badQuantity;
  }

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return { province: provinceCode as ProvinceCode, subscribe, cans };
}

export async function quoteCrate(request: QuoteRequest): Promise<Quote> {
  const settings = await loadSettings();
  return buildQuote(settings.pricing, request);
}

export function phraseFor(quote: Quote): string {
  return shippingPhrase(quote, provinceName(quote.province));
}

/** The cans a plan's box holds, used to quote and to take stock for a renewal. */
function planBox(planName: string): CanCount[] {
  const plan = findPlan(planName);
  if (plan === undefined) return [];
  return plan.box.map((entry) => ({ flavour: entry.flavour as FlavourSlug, quantity: entry.quantity }));
}

export async function quotePlanBox(
  planName: string,
  province: ProvinceCode,
  settings?: Settings,
): Promise<Quote> {
  const resolved = settings ?? (await loadSettings());
  return buildQuote(resolved.pricing, {
    province,
    subscribe: true,
    cans: planBox(planName),
  });
}
