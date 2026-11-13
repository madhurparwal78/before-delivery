import { CONFIG } from '../config.js';

export type ProductDoc = {
  id: string;
  slug: string;
  name: string;
  collection: string;
  category: string;
  material_slug: string;
  material: string;
  description: string;
  min_price: number;
  featured_rank: number;
  published_at: string;
  colours: string[];
  colour_slugs: string[];
  sizes: string[];
  size_slugs: string[];
  size_cm: string[];
  skus: string[];
  price_bands: string[];
  fit_codes: string[];
};

type MeiliResponse<T> = { hits: T[]; totalHits?: number; estimatedTotalHits?: number; facetsDistribution?: Record<string, Record<string, number>> };

let meiliUp = true;
let lastMeiliCheck = 0;

async function meiliFetch(path: string, method: string, body?: unknown): Promise<unknown> {
  const url = `${CONFIG.meilisearchUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (CONFIG.meilisearchApiKey) headers.authorization = `Bearer ${CONFIG.meilisearchApiKey}`;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    if (!res.ok) throw new Error(`meili ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function meiliReachable(): Promise<boolean> {
  try {
    await meiliFetch('/health', 'GET');
    meiliUp = true;
    lastMeiliCheck = Date.now();
    return true;
  } catch {
    meiliUp = false;
    lastMeiliCheck = Date.now();
    return false;
  }
}

export function meiliUpCached(): boolean {
  return meiliUp && Date.now() - lastMeiliCheck < 2000;
}

export async function meiliQuery(index: string, body: Record<string, unknown>): Promise<MeiliResponse<Record<string, unknown>>> {
  const json = await meiliFetch(`/indexes/${index}/search`, 'POST', body) as MeiliResponse<Record<string, unknown>>;
  return json;
}

export const PRICE_BANDS: { slug: string; label: string; min: number; max: number | null }[] = [
  { slug: 'under-5000', label: 'Under ₹5,000', min: 0, max: 4999 },
  { slug: '5000-9999', label: '₹5,000 to ₹9,999', min: 5000, max: 9999 },
  { slug: '10000-19999', label: '₹10,000 to ₹19,999', min: 10000, max: 19999 },
  { slug: '20000-plus', label: '₹20,000 and over', min: 20000, max: null },
];

export function priceBandFor(price: number): string | null {
  for (const band of PRICE_BANDS) {
    if (price >= band.min && (band.max === null || price <= band.max)) return band.slug;
  }
  return null;
}

// --- Index management -------------------------------------------------------

export async function ensureIndex(): Promise<void> {
  await meiliFetch('/indexes/products', 'POST', { uid: 'products', primaryKey: 'id' }).catch(() => undefined);
  await meiliFetch('/indexes/products/settings', 'PATCH', {
    searchableAttributes: ['name', 'skus', 'colours', 'colour_slugs', 'sizes', 'size_slugs', 'size_cm', 'category', 'material', 'material_slug', 'description', 'collection'],
    filterableAttributes: ['collection', 'category', 'colour_slugs', 'size_slugs', 'material_slug', 'price_bands', 'fit_codes'],
    sortableAttributes: ['min_price', 'published_at', 'featured_rank'],
    synonyms: {
      'carry-on': ['cabin'], 'carry on': ['cabin'], cabin: ['carry-on', 'carry on'],
      'check-in': ['hold'], hold: ['check-in'],
      suitcase: ['luggage'], luggage: ['suitcase'],
      rucksack: ['backpack'], backpack: ['rucksack'],
      duffle: ['duffel'], duffel: ['duffle'],
    },
    typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 } },
  }).catch(() => undefined);
}

export type DbProductRow = {
  slug: string; name: string; category: string; material: string; description: string;
  featured_rank: number; published_at: Date; status: string;
};

export type DbVariantRow = {
  sku: string; product_slug: string; colour: string; colour_slug: string; size: string; size_slug: string;
  height_cm: number; width_cm: number; depth_cm: number; price: number; compare_at: number | null;
};

export function buildDoc(product: DbProductRow, variants: DbVariantRow[], fitCodes: string[]): ProductDoc {
  const cheapest = [...variants].sort((a, b) => a.price - b.price)[0];
  const doc: ProductDoc = {
    id: product.slug,
    slug: product.slug,
    name: product.name,
    collection: product.category,
    category: product.category,
    material: product.material,
    material_slug: product.material.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    description: product.description,
    min_price: cheapest.price,
    featured_rank: product.featured_rank,
    published_at: product.published_at.toISOString(),
    colours: [...new Set(variants.map((v) => v.colour))],
    colour_slugs: [...new Set(variants.map((v) => v.colour_slug))],
    sizes: [...new Set(variants.map((v) => v.size))],
    size_slugs: [...new Set(variants.map((v) => v.size_slug))],
    size_cm: [...new Set(variants.map((v) => `${v.height_cm} cm`))],
    skus: variants.map((v) => v.sku),
    price_bands: [...new Set(variants.map((v) => priceBandFor(v.price)).filter((s): s is string => s !== null))],
    fit_codes: fitCodes,
  };
  return doc;
}

export async function pushDocs(docs: ProductDoc[]): Promise<void> {
  if (docs.length === 0) return;
  await meiliFetch('/indexes/products/documents', 'POST', docs).catch(() => undefined);
}

export async function deleteDoc(slug: string): Promise<void> {
  await meiliFetch(`/indexes/products/documents/${slug}`, 'DELETE').catch(() => undefined);
}

// --- Search ---------------------------------------------------------------

export type SearchFilters = {
  q: string;
  collection: string | null;
  category: string[];
  colour: string[];
  size: string[];
  material: string[];
  price: string[];
  fit: string[];
  sort: string;
  page: number;
};

export type SearchResultRow = {
  slug: string; name: string; category: string; min_price: number; compare_at: number | null; save_percent: number | null;
  colours: { name: string; slug: string; image_url: string }[]; badge: string; stock: number;
  featured_rank: number; published_at: string; material: string; varies_in_price: boolean;
};

export type FacetCounts = {
  category: Record<string, number>;
  colour: Record<string, number>;
  size: Record<string, number>;
  material: Record<string, number>;
  price: Record<string, number>;
  fit: Record<string, number>;
};

export type SearchOutcome = {
  mode: 'search' | 'fallback';
  total: number;
  page: number;
  page_size: number;
  results: SearchResultRow[];
  facets: FacetCounts | null;
  notice: string | null;
};

export const SEARCH_NOTICE = 'Search is unavailable. You can still browse and filter, but typo matching and filter counts are off.';
