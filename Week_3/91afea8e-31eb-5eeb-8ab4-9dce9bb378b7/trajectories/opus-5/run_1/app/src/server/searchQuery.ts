/** The one search query builder: Meilisearch when it answers, a title match when it does not. */

import { query } from './db.js';
import { deliveryPromise, type SellerRecord } from './domain/promise.js';
import { getPincode, productImageUrl } from './repo.js';
import { multiSearch, type IndexDocument, type MeiliQuery } from './services/search.js';
import type { SearchHit, SearchResponse } from '../shared/types.js';

export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'rating' | 'newest';

export type SearchParams = {
  q: string;
  category: string | null;
  brands: string[];
  sellers: string[];
  priceMinPaise: number | null;
  priceMaxPaise: number | null;
  rating: 3 | 4 | null;
  pin: string | null;
  deliverable: boolean;
  sort: SortKey;
  cursor: string | null;
  limit: number;
};

type Cursor = { v?: number; s?: number; o?: number; t?: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed as Cursor;
  } catch {
    return null;
  }
}

function escapeValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function baseFilters(params: SearchParams, skip: 'category' | 'brand' | 'seller' | 'rating' | null): string[] {
  const filters: string[] = [];
  if (params.category !== null && skip !== 'category') {
    filters.push(`category = ${escapeValue(params.category)}`);
  }
  if (params.brands.length > 0 && skip !== 'brand') {
    filters.push(`(${params.brands.map((brand) => `brand = ${escapeValue(brand)}`).join(' OR ')})`);
  }
  if (params.sellers.length > 0 && skip !== 'seller') {
    filters.push(
      `(${params.sellers.map((seller) => `seller_id = ${escapeValue(seller)}`).join(' OR ')})`,
    );
  }
  if (params.priceMinPaise !== null) filters.push(`price_paise >= ${params.priceMinPaise}`);
  if (params.priceMaxPaise !== null) filters.push(`price_paise <= ${params.priceMaxPaise}`);
  if (params.rating !== null && skip !== 'rating') filters.push(`rating >= ${params.rating}`);
  if (params.deliverable && params.pin !== null) {
    filters.push(`pincodes = ${escapeValue(params.pin)}`);
  }
  return filters;
}

function sortAndCursor(
  params: SearchParams,
): { sort: string[] | undefined; filter: string | null; offset: number } {
  const cursor = decodeCursor(params.cursor);
  const relevance = params.sort === 'relevance' && params.q !== '';
  if (relevance) {
    return { sort: undefined, filter: null, offset: cursor?.o ?? 0 };
  }
  const seq = cursor?.s;
  const value = cursor?.v;
  switch (params.sort) {
    case 'price_asc':
      return {
        sort: ['price_paise:asc', 'created_seq:asc'],
        filter:
          seq === undefined || value === undefined
            ? null
            : `(price_paise > ${value} OR (price_paise = ${value} AND created_seq > ${seq}))`,
        offset: 0,
      };
    case 'price_desc':
      return {
        sort: ['price_paise:desc', 'created_seq:desc'],
        filter:
          seq === undefined || value === undefined
            ? null
            : `(price_paise < ${value} OR (price_paise = ${value} AND created_seq < ${seq}))`,
        offset: 0,
      };
    case 'rating':
      return {
        sort: ['rating:desc', 'created_seq:desc'],
        filter:
          seq === undefined || value === undefined
            ? null
            : `(rating < ${value} OR (rating = ${value} AND created_seq < ${seq}))`,
        offset: 0,
      };
    default:
      return {
        sort: ['created_seq:desc'],
        filter: seq === undefined ? null : `created_seq < ${seq}`,
        offset: 0,
      };
  }
}

function cursorFor(params: SearchParams, last: IndexDocument, consumed: number): string {
  if (params.sort === 'relevance' && params.q !== '') {
    return encodeCursor({ o: consumed });
  }
  switch (params.sort) {
    case 'price_asc':
    case 'price_desc':
      return encodeCursor({ v: last.price_paise, s: last.created_seq });
    case 'rating':
      return encodeCursor({ v: last.rating, s: last.created_seq });
    default:
      return encodeCursor({ s: last.created_seq });
  }
}

async function sellerMap(): Promise<Map<string, SellerRecord>> {
  const rows = await query<SellerRecord>(
    `SELECT id, display_name, pickup_city, pickup_state, dispatch_days, rating, cod_allowed, ship_states
       FROM sellers`,
  );
  return new Map(rows.map((row) => [row.id, row]));
}

async function decorate(
  documents: IndexDocument[],
  pin: string | null,
  now: Date,
): Promise<SearchHit[]> {
  const destination = pin === null ? null : await getPincode(pin);
  const sellers = pin === null ? new Map<string, SellerRecord>() : await sellerMap();
  return documents.map((document) => {
    let delivers: boolean | null = null;
    let promiseDate: string | null = null;
    if (destination !== null) {
      const seller = sellers.get(document.seller_id);
      const promise =
        seller === undefined
          ? { promise_date: null }
          : deliveryPromise(seller, destination, false, now);
      delivers = promise.promise_date !== null;
      promiseDate = promise.promise_date;
    }
    return {
      listing_id: document.listing_id,
      product_id: document.product_id,
      title: document.title,
      brand: document.brand,
      category: document.category,
      seller_id: document.seller_id,
      seller_name: document.seller_name,
      price_paise: document.price_paise,
      rating: document.rating,
      image_url: productImageUrl(document.product_id),
      in_stock: document.in_stock,
      delivers,
      promise_date: promiseDate,
    };
  });
}

function facetCounts(distribution: Record<string, Record<string, number>> | undefined, key: string): Record<string, number> {
  const values = distribution?.[key] ?? {};
  const out: Record<string, number> = {};
  for (const [name, count] of Object.entries(values)) {
    if (count > 0) out[name] = count;
  }
  return out;
}

function ratingFacets(distribution: Record<string, Record<string, number>> | undefined): Record<string, number> {
  const values = distribution?.rating ?? {};
  let atLeastFour = 0;
  let atLeastThree = 0;
  for (const [value, count] of Object.entries(values)) {
    const rating = Number(value);
    if (rating >= 4) atLeastFour += count;
    if (rating >= 3) atLeastThree += count;
  }
  return { '4': atLeastFour, '3': atLeastThree };
}

async function degradedSearch(params: SearchParams, now: Date): Promise<SearchResponse> {
  const offset = decodeCursor(params.cursor)?.o ?? 0;
  const rows = await query<IndexDocument>(
    `SELECT l.id AS listing_id, l.product_id, p.title, p.brand, p.category_slug AS category,
            l.seller_id, s.display_name AS seller_name,
            CASE WHEN l.deal_price_paise IS NOT NULL AND l.deal_ends_at > now()
                 THEN l.deal_price_paise ELSE l.price_paise END AS price_paise,
            p.rating, (l.stock > 0) AS in_stock, l.created_seq, '' AS description,
            ARRAY[]::text[] AS pincodes
       FROM listings l
       JOIN products p ON p.id = l.product_id
       JOIN sellers s ON s.id = l.seller_id
      WHERE l.status = 'live' AND ($1 = '' OR p.title ILIKE '%' || $1 || '%')
      ORDER BY l.created_seq DESC
      LIMIT $2 OFFSET $3`,
    [params.q, params.limit + 1, offset],
  );
  const counted = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM listings l JOIN products p ON p.id = l.product_id
      WHERE l.status = 'live' AND ($1 = '' OR p.title ILIKE '%' || $1 || '%')`,
    [params.q],
  );
  const page = rows.slice(0, params.limit);
  return {
    hits: await decorate(page, params.pin, now),
    facets: { category: {}, brand: {}, seller: {}, rating: {} },
    total: counted[0].total,
    next_cursor: rows.length > params.limit ? encodeCursor({ o: offset + params.limit }) : null,
    degraded: true,
  };
}

export async function runSearch(params: SearchParams, now = new Date()): Promise<SearchResponse> {
  const { sort, filter, offset } = sortAndCursor(params);
  const allFilters = baseFilters(params, null);
  const hitFilters = filter === null ? allFilters : [...allFilters, filter];
  const facetQuery = (
    skip: 'category' | 'brand' | 'seller' | 'rating',
    facet: string,
  ): MeiliQuery => ({
    q: params.q,
    filter: baseFilters(params, skip),
    limit: 0,
    facets: [facet],
  });

  const results = await multiSearch([
    { q: params.q, filter: hitFilters, sort, limit: params.limit + 1, offset },
    { q: params.q, filter: allFilters, limit: 0 },
    facetQuery('category', 'category'),
    facetQuery('brand', 'brand'),
    facetQuery('seller', 'seller_id'),
    facetQuery('rating', 'rating'),
  ]);
  if (results === null || results.length < 6) return degradedSearch(params, now);

  const [hitsResult, totalResult, categoryResult, brandResult, sellerResult, ratingResult] = results;
  const page = hitsResult.hits.slice(0, params.limit);
  const more = hitsResult.hits.length > params.limit;
  return {
    hits: await decorate(page, params.pin, now),
    facets: {
      category: facetCounts(categoryResult.facetDistribution, 'category'),
      brand: facetCounts(brandResult.facetDistribution, 'brand'),
      seller: facetCounts(sellerResult.facetDistribution, 'seller_id'),
      rating: ratingFacets(ratingResult.facetDistribution),
    },
    total: totalResult.estimatedTotalHits,
    next_cursor:
      more && page.length > 0
        ? cursorFor(params, page[page.length - 1], offset + params.limit)
        : null,
    degraded: false,
  };
}
