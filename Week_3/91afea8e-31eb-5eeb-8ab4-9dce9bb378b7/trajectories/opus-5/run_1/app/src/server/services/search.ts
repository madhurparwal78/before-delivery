/** Meilisearch: the index, its sync and the one search query builder. */

import { config } from '../config.js';

const TIMEOUT_MS = 5_000;

export type IndexDocument = {
  listing_id: string;
  product_id: string;
  title: string;
  brand: string;
  category: string;
  description: string;
  seller_id: string;
  seller_name: string;
  price_paise: number;
  rating: number;
  in_stock: boolean;
  pincodes: string[];
  created_seq: number;
};

async function call(
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.meilisearch.url}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${config.meilisearch.apiKey}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text === '' ? {} : (JSON.parse(text) as unknown);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureIndex(): Promise<boolean> {
  const index = config.meilisearch.index;
  const existing = await call(`/indexes/${index}`, { method: 'GET' });
  if (existing === null) {
    const created = await call('/indexes', {
      method: 'POST',
      body: { uid: index, primaryKey: 'listing_id' },
    });
    if (created === null) return false;
  }
  const settings = await call(`/indexes/${index}/settings`, {
    method: 'PATCH',
    body: {
      searchableAttributes: ['title', 'brand', 'description', 'seller_name'],
      filterableAttributes: [
        'category',
        'brand',
        'seller_id',
        'price_paise',
        'rating',
        'pincodes',
        'in_stock',
        'created_seq',
      ],
      sortableAttributes: ['price_paise', 'rating', 'created_seq'],
      typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 } },
    },
  });
  return settings !== null;
}

export async function upsertDocuments(documents: IndexDocument[]): Promise<boolean> {
  if (documents.length === 0) return true;
  const reply = await call(`/indexes/${config.meilisearch.index}/documents`, {
    method: 'POST',
    body: documents,
  });
  return reply !== null;
}

export async function deleteDocuments(listingIds: string[]): Promise<boolean> {
  if (listingIds.length === 0) return true;
  const reply = await call(`/indexes/${config.meilisearch.index}/documents/delete-batch`, {
    method: 'POST',
    body: listingIds,
  });
  return reply !== null;
}

export type MeiliQuery = {
  q: string;
  filter: string[];
  sort?: string[];
  limit: number;
  offset?: number;
  facets?: string[];
};

export type MeiliResult = {
  hits: IndexDocument[];
  estimatedTotalHits: number;
  facetDistribution?: Record<string, Record<string, number>>;
};

export async function multiSearch(queries: MeiliQuery[]): Promise<MeiliResult[] | null> {
  const reply = await call('/multi-search', {
    method: 'POST',
    body: {
      queries: queries.map((query) => ({
        indexUid: config.meilisearch.index,
        q: query.q,
        filter: query.filter,
        sort: query.sort,
        limit: query.limit,
        offset: query.offset ?? 0,
        facets: query.facets,
      })),
    },
  });
  if (reply === null || typeof reply !== 'object') return null;
  const results = (reply as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  return results as MeiliResult[];
}
