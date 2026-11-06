/**
 * Catalogue reads. The seeded catalogue is small, so every query loads it once and
 * the published filter rules are applied in one readable place.
 */

import { query, queryOne } from "../db/pool.js";
import { projectVariant, type Viewer, type VariantSource } from "../../shared/projection.js";
import { PRODUCT_PAGE_CEILING_MM, soloPool } from "../../shared/lightpool.js";
import type { ComparisonItem, FamilySlug, Product } from "../../shared/types.js";

export interface VariantRecord extends VariantSource {
  product_slug: string;
  product_name: string;
  product_family: Exclude<FamilySlug, "clearance">;
  watts: number;
  cri: number;
  ip_rating: string;
  sort_order: number;
}

export interface ProductRecord {
  slug: string;
  name: string;
  family: Exclude<FamilySlug, "clearance">;
  description: string;
  watts: number;
  cri: number;
  ip_rating: string;
  default_variant: string;
  sort_order: number;
}

const VARIANT_COLUMNS = `
  v.code, v.finish, v.finish_name, v.beam_deg, v.cct_k, v.lumens, v.candela,
  v.retail_price_cents, v.trade_price_cents, v.was_price_cents, v.clearance, v.sort_order,
  v.product_slug, p.name AS product_name, p.family AS product_family,
  p.watts, p.cri, p.ip_rating,
  COALESCE((SELECT SUM(m.delta) FROM stock_movements m WHERE m.variant_code = v.code), 0)::int AS stock_on_hand
`;

export async function loadAllVariants(): Promise<VariantRecord[]> {
  return query<VariantRecord>(
    `SELECT ${VARIANT_COLUMNS} FROM variants v JOIN products p ON p.slug = v.product_slug ORDER BY v.sort_order`,
  );
}

export async function loadVariant(code: string): Promise<VariantRecord | null> {
  return queryOne<VariantRecord>(
    `SELECT ${VARIANT_COLUMNS} FROM variants v JOIN products p ON p.slug = v.product_slug WHERE v.code = $1`,
    [code],
  );
}

export async function loadProducts(): Promise<ProductRecord[]> {
  return query<ProductRecord>("SELECT * FROM products ORDER BY sort_order");
}

export interface CatalogueFilters {
  q: string;
  family: string | null;
  finishes: string[];
  beams: number[];
  ccts: number[];
  clearanceOnly: boolean;
}

/** Parses the published query parameters. Unknown values match nothing. */
export function parseCatalogueFilters(params: URLSearchParams): CatalogueFilters {
  const list = (name: string): string[] =>
    (params.get(name) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

  const numberList = (name: string): number[] =>
    list(name).map((value) => (/^\d+$/.test(value) ? Number(value) : Number.NaN));

  return {
    q: (params.get("q") ?? "").trim().toLowerCase(),
    family: params.get("family"),
    finishes: list("finish").map((value) => value.toUpperCase()),
    beams: numberList("beam"),
    ccts: numberList("cct"),
    clearanceOnly: params.get("clearance") === "true",
  };
}

function variantMatches(variant: VariantRecord, filters: CatalogueFilters): boolean {
  if (filters.finishes.length > 0 && !filters.finishes.includes(variant.finish)) return false;
  if (filters.beams.length > 0 && !filters.beams.includes(variant.beam_deg)) return false;
  if (filters.ccts.length > 0 && !filters.ccts.includes(variant.cct_k)) return false;
  if (filters.clearanceOnly && !variant.clearance) return false;
  // The clearance family holds the products that have a clearance variant.
  if (filters.family === "clearance" && !variant.clearance) return false;
  return true;
}

function productMatchesSearch(product: ProductRecord, variants: readonly VariantRecord[], q: string): boolean {
  if (q === "") return true;
  if (product.name.toLowerCase().includes(q)) return true;
  if (product.description.toLowerCase().includes(q)) return true;
  return variants.some((variant) => variant.code.toLowerCase().includes(q));
}

/**
 * A product is returned when `q` matches it and at least one of its variants
 * matches every given filter at once. Each returned product carries all of its
 * variants, not only the matching ones.
 */
export function filterCatalogue(
  products: readonly ProductRecord[],
  variants: readonly VariantRecord[],
  filters: CatalogueFilters,
  viewer: Viewer | null,
): Product[] {
  const byProduct = new Map<string, VariantRecord[]>();
  for (const variant of variants) {
    const list = byProduct.get(variant.product_slug) ?? [];
    list.push(variant);
    byProduct.set(variant.product_slug, list);
  }

  const results: Product[] = [];
  for (const product of products) {
    const own = byProduct.get(product.slug) ?? [];
    const filtersByProductFamily = filters.family !== null && filters.family !== "clearance";
    if (filtersByProductFamily && product.family !== filters.family) continue;
    if (!productMatchesSearch(product, own, filters.q)) continue;
    if (!own.some((variant) => variantMatches(variant, filters))) continue;
    results.push(toProduct(product, own, viewer));
  }
  return results;
}

export function toProduct(
  product: ProductRecord,
  variants: readonly VariantRecord[],
  viewer: Viewer | null,
): Product {
  return {
    slug: product.slug,
    name: product.name,
    family: product.family,
    description: product.description,
    watts: product.watts,
    cri: product.cri,
    ip_rating: product.ip_rating,
    default_variant: product.default_variant,
    variants: variants.map((variant) => projectVariant(variant, viewer)),
  };
}

export async function loadProduct(slug: string, viewer: Viewer | null): Promise<Product | null> {
  const product = await queryOne<ProductRecord>("SELECT * FROM products WHERE slug = $1", [slug]);
  if (!product) return null;
  const variants = await query<VariantRecord>(
    `SELECT ${VARIANT_COLUMNS} FROM variants v JOIN products p ON p.slug = v.product_slug
     WHERE v.product_slug = $1 ORDER BY v.sort_order`,
    [slug],
  );
  return toProduct(product, variants, viewer);
}

/** Comparison rows carry the caller's variant keys plus the product's specs at 2.7 m. */
export function toComparisonItem(variant: VariantRecord, viewer: Viewer | null): ComparisonItem {
  const pool = soloPool(variant.beam_deg, variant.candela, PRODUCT_PAGE_CEILING_MM);
  return {
    ...projectVariant(variant, viewer),
    product_slug: variant.product_slug,
    product_name: variant.product_name,
    watts: variant.watts,
    cri: variant.cri,
    ip_rating: variant.ip_rating,
    pool_diameter_mm_at_2700: pool.pool_diameter_mm,
    centre_lux_at_2700: pool.centre_lux,
  };
}
