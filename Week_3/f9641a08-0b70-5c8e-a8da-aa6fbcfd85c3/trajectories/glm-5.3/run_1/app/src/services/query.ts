import { CONFIG } from '../config.js';
import type { Client } from '../db/pool.js';
import { SEARCH_NOTICE, meiliQuery, type SearchFilters, type SearchOutcome, type SearchResultRow, type FacetCounts } from './search.js';
import { loadCatalog, toResultRows, groupVariants, textMatchesFallback, matchesFilters } from './catalog.js';

const GROUP_KEYS: (keyof FacetCounts)[] = ['category', 'colour', 'size', 'material', 'price', 'fit'];

/**
 * The one place storefront search runs. Prefers Meilisearch; falls back to a
 * PostgreSQL listing (plain contains, no counts) when the engine is down.
 * Each facet group's counts come from a query with every other group's
 * choices applied but not its own.
 */
export async function runSearch(client: Client, filters: SearchFilters): Promise<SearchOutcome> {
  try {
    const matchedSlugs = await meiliMatched(filters);
    const rows = await loadCatalog(client, filters.collection);
    const map = groupVariants(rows);
    const filteredRows: typeof rows = [];
    for (const [slug, variants] of map) {
      if (!matchedSlugs.has(slug)) continue;
      if (!matchesFilters(variants, filters, null)) continue;
      filteredRows.push(...variants);
    }
    const results = sortRows(toResultRows(filteredRows), filters.sort, filters.q);
    const page = Math.max(1, filters.page);
    const start = (page - 1) * CONFIG.pageSize;
    let facets: FacetCounts | null = null;
    try {
      facets = await computeFacets(filters);
    } catch {
      facets = null;
    }
    return {
      mode: 'search',
      total: results.length,
      page,
      page_size: CONFIG.pageSize,
      results: results.slice(start, start + CONFIG.pageSize),
      facets,
      notice: null,
    };
  } catch {
    return fallbackSearch(client, filters);
  }
}

async function meiliMatched(filters: SearchFilters): Promise<Set<string>> {
  const filterExpr = buildMeiliFilter(filters);
  const body: Record<string, unknown> = {
    q: filters.q,
    limit: 1000,
    attributesToRetrieve: ['slug'],
  };
  if (filterExpr !== null) body.filter = filterExpr;
  const res = await meiliQuery('products', body);
  return new Set((res.hits as { slug: string }[]).map((h) => h.slug));
}

/** One Meilisearch query per group, each excluding that group's own choices. */
async function computeFacets(filters: SearchFilters): Promise<FacetCounts> {
  const counts: FacetCounts = { category: {}, colour: {}, size: {}, material: {}, price: {}, fit: {} };
  const label = facetKeyForGroup();
  await Promise.all(GROUP_KEYS.map(async (group) => {
    const sub: SearchFilters = { ...filters, [group]: [] };
    const filterExpr = buildMeiliFilter(sub);
    const body: Record<string, unknown> = {
      q: filters.q,
      limit: 0,
      facets: [label[group]],
    };
    if (filterExpr !== null) body.filter = filterExpr;
    const res = await meiliQuery('products', body);
    const dist = (res as unknown as { facetDistribution?: Record<string, Record<string, number>> }).facetDistribution;
    const raw = dist?.[label[group]] ?? {};
    for (const [value, count] of Object.entries(raw)) {
      counts[group][value] = count;
    }
  }));
  return counts;
}

function facetKeyForGroup(): Record<keyof FacetCounts, string> {
  return {
    category: 'category',
    colour: 'colour_slugs',
    size: 'size_slugs',
    material: 'material_slug',
    price: 'price_bands',
    fit: 'fit_codes',
  };
}

async function fallbackSearch(client: Client, filters: SearchFilters): Promise<SearchOutcome> {
  const rows = await loadCatalog(client, filters.collection);
  const map = groupVariants(rows);
  const filteredRows: typeof rows = [];
  for (const [slug, variants] of map) {
    if (!textMatchesFallback(filters.q, variants)) continue;
    if (!matchesFilters(variants, filters, null)) continue;
    filteredRows.push(...variants);
  }
  const results = sortRows(toResultRows(filteredRows), filters.sort, filters.q);
  const page = Math.max(1, filters.page);
  const start = (page - 1) * CONFIG.pageSize;
  return {
    mode: 'fallback',
    total: results.length,
    page,
    page_size: CONFIG.pageSize,
    results: results.slice(start, start + CONFIG.pageSize),
    facets: null,
    notice: SEARCH_NOTICE,
  };
}

export function sortRows(rows: SearchResultRow[], sort: string, q: string): SearchResultRow[] {
  const byName = (a: SearchResultRow, b: SearchResultRow) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (sort === 'price-asc') return [...rows].sort((a, b) => a.min_price - b.min_price || byName(a, b));
  if (sort === 'price-desc') return [...rows].sort((a, b) => b.min_price - a.min_price || byName(a, b));
  if (sort === 'newest') return [...rows].sort((a, b) => (b.published_at < a.published_at ? -1 : b.published_at > a.published_at ? 1 : 0) || byName(a, b));
  if (q !== '') return [...rows].sort((a, b) => (a.featured_rank - b.featured_rank) || (a.min_price - b.min_price) || byName(a, b));
  return [...rows].sort((a, b) => (a.featured_rank - b.featured_rank) || byName(a, b));
}

function buildMeiliFilter(filters: SearchFilters): string | null {
  const exprs: string[] = [];
  if (filters.collection && filters.collection !== 'all') exprs.push(`collection = "${filters.collection}"`);
  if (filters.category.length > 0) exprs.push(`(${filters.category.map((c) => `category = "${c}"`).join(' OR ')})`);
  if (filters.colour.length > 0) exprs.push(`(${filters.colour.map((c) => `colour_slugs = "${c}"`).join(' OR ')})`);
  if (filters.size.length > 0) exprs.push(`(${filters.size.map((s) => `size_slugs = "${s}"`).join(' OR ')})`);
  if (filters.material.length > 0) exprs.push(`(${filters.material.map((m) => `material_slug = "${m}"`).join(' OR ')})`);
  if (filters.price.length > 0) exprs.push(`(${filters.price.map((p) => `price_bands = "${p}"`).join(' OR ')})`);
  if (filters.fit.length > 0) exprs.push(`(${filters.fit.map((f) => `fit_codes = "${f}"`).join(' OR ')})`);
  if (exprs.length === 0) return null;
  return exprs.join(' AND ');
}
