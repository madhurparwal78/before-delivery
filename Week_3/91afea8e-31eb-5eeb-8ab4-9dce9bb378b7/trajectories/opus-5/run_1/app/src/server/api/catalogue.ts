/** Public catalogue: pincodes, search, products, offers, compare, EMI plans and banks. */

import { one, query } from '../db.js';
import { emiAmountAllowed, emiPlans } from '../domain/emi.js';
import { PINCODE_PATTERN } from '../domain/identity.js';
import { standardDeliveryFee } from '../domain/money.js';
import { markFeatured, rankOffers } from '../domain/offers.js';
import { deliveryPromise } from '../domain/promise.js';
import { notFound, validationFailed } from '../http/errors.js';
import { json, route, type Ctx } from '../http/router.js';
import {
  effectivePrice,
  getListing,
  getListingsForProduct,
  getPincode,
  sellerOf,
  type ListingRecord,
} from '../repo.js';
import { runSearch, type SearchParams, type SortKey } from '../searchQuery.js';
import { BANKS } from '../services/provider.js';
import { COPY, FIELD } from '../../shared/messages.js';
import type { Offer } from '../../shared/types.js';

const SORTS: SortKey[] = ['relevance', 'price_asc', 'price_desc', 'rating', 'newest'];

function csv(value: string | null): string[] {
  if (value === null || value.trim() === '') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function wholeRupeesToPaise(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed) * 100;
}

function readSearchParams(ctx: Ctx): SearchParams {
  const errors: Record<string, string> = {};
  const q = ctx.query.get('q') ?? '';
  if (q.length > 100) errors.q = FIELD.tooLong('Name', 100);
  const limitRaw = ctx.query.get('limit');
  let limit = 24;
  if (limitRaw !== null && limitRaw !== '') {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24) {
      errors.limit = FIELD.badSearchLimit;
    } else {
      limit = parsed;
    }
  }
  const ratingRaw = ctx.query.get('rating');
  let rating: 3 | 4 | null = null;
  if (ratingRaw !== null && ratingRaw !== '') {
    if (ratingRaw === '3') rating = 3;
    else if (ratingRaw === '4') rating = 4;
    else errors.rating = FIELD.badSearchLimit;
  }
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  const sortRaw = (ctx.query.get('sort') ?? '') as SortKey;
  const sort = SORTS.includes(sortRaw) ? sortRaw : q === '' ? 'newest' : 'relevance';
  const pin = ctx.query.get('pin');
  return {
    q,
    category: ctx.query.get('category') === '' ? null : ctx.query.get('category'),
    brands: csv(ctx.query.get('brand')),
    sellers: csv(ctx.query.get('seller')),
    priceMinPaise: wholeRupeesToPaise(ctx.query.get('price_min')),
    priceMaxPaise: wholeRupeesToPaise(ctx.query.get('price_max')),
    rating,
    pin: pin !== null && PINCODE_PATTERN.test(pin) ? pin : null,
    deliverable: ctx.query.get('deliverable') === '1',
    sort,
    cursor: ctx.query.get('cursor'),
    limit,
  };
}

function offerFor(listing: ListingRecord, pin: string | null, destination: Awaited<ReturnType<typeof getPincode>>, now: Date): Offer {
  const seller = sellerOf(listing);
  const price = effectivePrice(listing, now);
  const fee = standardDeliveryFee(price);
  const promise = pin === null ? { promise_date: null } : deliveryPromise(seller, destination, false, now);
  return {
    listing_id: listing.listing_id,
    seller_id: listing.seller_id,
    seller_name: listing.seller_name,
    seller_rating: listing.seller_rating,
    price_paise: price,
    delivery_fee_paise: fee,
    landed_paise: price + fee,
    promise_date: promise.promise_date,
    cod_available:
      listing.cod_allowed &&
      listing.seller_cod_allowed &&
      (destination === null ? false : destination.cod && destination.serviceable),
    in_stock: listing.stock > 0,
    featured: false,
  };
}

async function offersForProduct(productId: string, pin: string | null, now: Date): Promise<Offer[]> {
  const listings = await getListingsForProduct(productId);
  const destination = pin === null ? null : await getPincode(pin);
  const offers = listings.map((listing) => offerFor(listing, pin, destination, now));
  return markFeatured(rankOffers(offers));
}

export function registerCatalogueRoutes(): void {
  route(
    'GET',
    '/api/pincodes/:pincode',
    'public',
    async (ctx) => {
      const pincode = ctx.params.pincode;
      if (!PINCODE_PATTERN.test(pincode)) {
        throw validationFailed({ pincode: FIELD.badPincode });
      }
      const record = await getPincode(pincode);
      const known = record !== null && record.city !== '';
      return json({
        pincode,
        city: known ? record.city : null,
        state: known ? record.state : null,
        serviceable: record !== null && record.serviceable,
        cod_available: record !== null && record.cod && record.serviceable,
      });
    },
    { rate: 'pincode' },
  );

  route('GET', '/api/search', 'public', async (ctx) => {
    const params = readSearchParams(ctx);
    return json(await runSearch(params));
  });

  route('GET', '/api/products/:productId', 'public', async (ctx) => {
    const now = new Date();
    const product = await one<{
      id: string;
      title: string;
      brand: string;
      category_slug: string;
      rating: number;
      description: string;
      specs: Record<string, string>;
      gst_rate: number;
    }>(
      `SELECT p.id, p.title, p.brand, p.category_slug, p.rating, p.description, p.specs, c.gst_rate
         FROM products p JOIN categories c ON c.slug = p.category_slug WHERE p.id = $1`,
      [ctx.params.productId],
    );
    if (product === null) throw notFound();
    const pin = ctx.query.get('pin');
    const offers = await offersForProduct(product.id, pin !== null && PINCODE_PATTERN.test(pin) ? pin : null, now);
    return json({
      id: product.id,
      title: product.title,
      brand: product.brand,
      category: product.category_slug,
      gst_rate: product.gst_rate,
      rating: product.rating,
      description: product.description,
      specs: product.specs,
      offers_count: offers.length,
      featured_offer: offers.find((offer) => offer.featured) ?? null,
    });
  });

  route('GET', '/api/products/:productId/offers', 'public', async (ctx) => {
    const limitRaw = ctx.query.get('limit');
    let limit = 10;
    if (limitRaw !== null && limitRaw !== '') {
      const parsed = Number(limitRaw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
        throw validationFailed({ limit: FIELD.badOffersLimit });
      }
      limit = parsed;
    }
    const exists = await one<{ id: string }>(`SELECT id FROM products WHERE id = $1`, [
      ctx.params.productId,
    ]);
    if (exists === null) throw notFound();
    const pin = ctx.query.get('pin');
    const offers = await offersForProduct(
      ctx.params.productId,
      pin !== null && PINCODE_PATTERN.test(pin) ? pin : null,
      new Date(),
    );
    return json({ offers: offers.slice(0, limit), total: offers.length });
  });

  route('GET', '/api/compare', 'public', async (ctx) => {
    const ids = csv(ctx.query.get('ids'));
    if (ids.length > 4) throw validationFailed({ ids: COPY.compareOverFour });
    if (ids.length < 2) throw validationFailed({ ids: COPY.compareUnderTwo });
    const products = await query<{
      id: string;
      title: string;
      brand: string;
      rating: number;
      category_slug: string;
      specs: Record<string, string>;
    }>(
      `SELECT id, title, brand, rating, category_slug, specs FROM products WHERE id = ANY($1)`,
      [ids],
    );
    if (products.length !== ids.length) throw notFound();
    const ordered = ids.flatMap((id) => products.filter((product) => product.id === id));
    const categories = new Set(ordered.map((product) => product.category_slug));
    if (categories.size > 1) throw validationFailed({ ids: COPY.compareMixedCategories });

    const now = new Date();
    const prices = new Map<string, number>();
    for (const product of ordered) {
      const listings = await getListingsForProduct(product.id);
      const best = listings
        .map((listing) => effectivePrice(listing, now))
        .reduce((lowest, price) => (price < lowest ? price : lowest), Number.MAX_SAFE_INTEGER);
      prices.set(product.id, best === Number.MAX_SAFE_INTEGER ? 0 : best);
    }

    const specKeys: string[] = [];
    for (const product of ordered) {
      for (const key of Object.keys(product.specs)) {
        if (!specKeys.includes(key)) specKeys.push(key);
      }
    }
    const rows: { name: string; values: string[]; differs: boolean }[] = [];
    const addRow = (name: string, values: string[]): void => {
      rows.push({ name, values, differs: new Set(values).size > 1 });
    };
    addRow('Brand', ordered.map((product) => product.brand));
    addRow('Rating', ordered.map((product) => product.rating.toFixed(1)));
    addRow(
      'Best price',
      ordered.map((product) => String(prices.get(product.id) ?? 0)),
    );
    for (const key of specKeys) {
      addRow(
        key,
        ordered.map((product) => product.specs[key] ?? ''),
      );
    }

    return json({
      category: ordered[0].category_slug,
      products: ordered.map((product) => ({
        id: product.id,
        title: product.title,
        brand: product.brand,
        rating: product.rating,
        best_price_paise: prices.get(product.id) ?? 0,
        specs: product.specs,
      })),
      attributes: rows,
    });
  });

  route('GET', '/api/emi-plans', 'public', async (ctx) => {
    const listingId = ctx.query.get('listing_id');
    if (listingId === null) throw validationFailed({ amount: FIELD.emiTooSmall });
    const listing = await getListing(listingId);
    if (listing === null) throw notFound();
    const amount = effectivePrice(listing, new Date());
    if (!emiAmountAllowed(amount)) throw validationFailed({ amount: FIELD.emiTooSmall });
    return json(emiPlans(amount, listing.no_cost_emi));
  });

  route('GET', '/api/banks', 'public', async () => json({ banks: BANKS }));
}
