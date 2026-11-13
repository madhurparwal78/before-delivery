import type { Client } from '../db/pool.js';
import { stockBadge } from '../domain/fit.js';
import {
  PRICE_BANDS, SEARCH_NOTICE, priceBandFor, meiliQuery,
  type SearchFilters, type SearchResultRow, type FacetCounts, type SearchOutcome,
} from './search.js';
import { airlineCodes } from './airlines.js';

export type CatalogRow = {
  slug: string; name: string; category: string; material: string; description: string;
  featured_rank: number; published_at: Date;
  sku: string; colour: string; colour_slug: string; size: string; size_slug: string;
  height_cm: number; width_cm: number; depth_cm: number; price: number; compare_at: number | null;
  available: number;
  image_id: string | null;
};

/** Loads the published catalogue with per-variant available counts. */
export async function loadCatalog(client: Client, collection: string | null): Promise<CatalogRow[]> {
  const params: unknown[] = [];
  let where = `p.status = 'published'`;
  if (collection && collection !== 'all') {
    params.push(collection);
    where += ` AND p.category = $${params.length}`;
  }
  const res = await client.query<CatalogRow>(`
    SELECT p.slug, p.name, p.category, p.material, p.description, p.featured_rank, p.published_at,
           v.sku, v.colour, v.colour_slug, v.size, v.size_slug, v.height_cm, v.width_cm, v.depth_cm,
           v.price, v.compare_at,
           COALESCE(SUM(e.quantity) FILTER (WHERE e.account = 'available'), 0)::INT AS available,
           (SELECT i.id FROM product_images i WHERE i.product_slug = p.slug AND i.colour_slug = v.colour_slug ORDER BY i.position LIMIT 1) AS image_id
    FROM products p
    JOIN variants v ON v.product_slug = p.slug
    LEFT JOIN stock_entries e ON e.sku = v.sku
    WHERE ${where}
    GROUP BY p.slug, v.sku
    ORDER BY p.featured_rank, v.position`, params);
  return res.rows;
}

export function groupVariants(rows: CatalogRow[]): Map<string, CatalogRow[]> {
  const map = new Map<string, CatalogRow[]>();
  for (const row of rows) {
    const list = map.get(row.slug) ?? [];
    list.push(row);
    map.set(row.slug, list);
  }
  return map;
}

/** The card price variant: cheapest, first in seed order on a tie. */
export function cardVariant(variants: CatalogRow[]): CatalogRow {
  let best = variants[0];
  for (const v of variants) if (v.price < best.price) best = v;
  return best;
}

export function toResultRows(rows: CatalogRow[]): SearchResultRow[] {
  const map = groupVariants(rows);
  const out: SearchResultRow[] = [];
  for (const [slug, variants] of map) {
    const first = variants[0];
    const card = cardVariant(variants);
    const stock = variants.reduce((sum, v) => sum + v.available, 0);
    const colours = [...new Map(variants.map((v) => [v.colour_slug, { name: v.colour, slug: v.colour_slug, image_url: v.image_id === null ? '' : `/media/products/${v.image_id}` }])).values()];
    const prices = new Set(variants.map((v) => v.price));
    out.push({
      slug,
      name: first.name,
      category: first.category,
      material: first.material,
      varies_in_price: prices.size > 1,
      featured_rank: first.featured_rank,
      published_at: first.published_at.toISOString(),
      min_price: card.price,
      compare_at: card.compare_at,
      save_percent: card.compare_at === null ? null : Math.round(((card.compare_at - card.price) * 100) / card.compare_at),
      colours,
      badge: stockBadge(stock),
      stock,
    });
  }
  return out;
}

/** Fallback matching: plain contains on name and SKU, ignoring case. */
export function textMatchesFallback(q: string, variants: CatalogRow[]): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  const first = variants[0];
  return first.name.toLowerCase().includes(needle) || variants.some((v) => v.sku.toLowerCase().includes(needle));
}

function fitCodesOf(variants: CatalogRow[]): string[] {
  const codes: string[] = [];
  for (const airline of airlineCodes()) {
    if (variants.some((v) => v.height_cm <= airline.height_cm && v.width_cm <= airline.width_cm && v.depth_cm <= airline.depth_cm)) {
      codes.push(airline.code);
    }
  }
  return codes;
}

type FilterKey = 'category' | 'colour' | 'size' | 'material' | 'price' | 'fit';

export function matchesFilters(variants: CatalogRow[], filters: SearchFilters, skip: FilterKey | null): boolean {
  const active = (key: FilterKey) => key !== skip && filters[key].length > 0;
  if (active('category') && !filters.category.includes(variants[0].category)) return false;
  if (active('colour') && !variants.some((v) => filters.colour.includes(v.colour_slug))) return false;
  if (active('size') && !variants.some((v) => filters.size.includes(v.size_slug))) return false;
  if (active('material') && !filters.material.includes(variants[0].material)) return false;
  if (active('price') && !variants.some((v) => filters.price.includes(priceBandFor(v.price) ?? ''))) return false;
  if (active('fit')) {
    const codes = fitCodesOf(variants);
    if (!filters.fit.some((code) => codes.includes(code))) return false;
  }
  return true;
}

