import { config } from '../config';

export type ProductDocument = {
  id: string;
  slug: string;
  name: string;
  skus: string[];
  colours: string[];
  colour: string[];
  sizes: string[];
  size: string[];
  size_cm: string[];
  category: string;
  collection: string[];
  material: string;
  material_slug: string[];
  description: string;
  price: string[];
  fit: string[];
  min_price: number;
  price_varies: boolean;
  compare_at: number | null;
  save_percent: number | null;
  badge: string;
  colour_options: Array<{ name: string; slug: string; image_url: string }>;
  published_at: number;
  featured_rank: number;
};

const SETTINGS = {
  searchableAttributes: ['name', 'skus', 'colours', 'sizes', 'size_cm', 'category', 'material', 'description'],
  filterableAttributes: ['collection', 'category', 'colour', 'size', 'material_slug', 'price', 'fit'],
  sortableAttributes: ['min_price', 'published_at', 'featured_rank', 'name'],
  synonyms: {
    'carry-on': ['carry on', 'cabin'],
    'carry on': ['carry-on', 'cabin'],
    cabin: ['carry-on', 'carry on'],
    'check-in': ['hold'],
    hold: ['check-in'],
    suitcase: ['luggage'],
    luggage: ['suitcase'],
    rucksack: ['backpack'],
    backpack: ['rucksack'],
    duffle: ['duffel'],
    duffel: ['duffle']
  },
  typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 7 } },
  pagination: { maxTotalHits: 1000 }
};

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${config.meilisearchUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.meilisearchApiKey}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(4000)
  });
}

export async function ensureIndex(): Promise<void> {
  await call('/indexes', 'POST', { uid: 'products', primaryKey: 'id' });
  const response = await call('/indexes/products/settings', 'PATCH', SETTINGS);
  if (!response.ok) throw new Error(`Meilisearch settings failed: ${response.status}`);
}

export async function upsertDocuments(documents: ProductDocument[]): Promise<void> {
  if (documents.length === 0) return;
  const response = await call('/indexes/products/documents', 'PUT', documents);
  if (!response.ok) throw new Error(`Meilisearch upsert failed: ${response.status}`);
}

export async function deleteDocuments(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const response = await call('/indexes/products/documents/delete-batch', 'POST', ids);
  if (!response.ok) throw new Error(`Meilisearch delete failed: ${response.status}`);
}

export type SearchQuery = {
  q: string;
  filter: string[][];
  sort: string[];
  offset: number;
  limit: number;
  facets?: string[];
};

export type SearchHits = {
  hits: ProductDocument[];
  estimatedTotalHits: number;
  facetDistribution?: Record<string, Record<string, number>>;
};

export async function runSearch(query: SearchQuery): Promise<SearchHits> {
  const response = await call('/indexes/products/search', 'POST', {
    q: query.q,
    filter: query.filter,
    sort: query.sort,
    offset: query.offset,
    limit: query.limit,
    facets: query.facets ?? [],
    attributesToRetrieve: ['*']
  });
  if (!response.ok) throw new Error(`Meilisearch search failed: ${response.status}`);
  return (await response.json()) as SearchHits;
}

export async function searchReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.meilisearchUrl}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}
