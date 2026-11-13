import { SIZE_LABELS } from "../shared/format";
import type { Product, ProductImage, StockBadge, Variant } from "../shared/api";
import { config } from "./config";
import { rows, one, type Queryable } from "./db";
import { hasCabinFit } from "../shared/cabin";
import { cabinFit, type Frame } from "./fit";
import { roundHalfUp } from "./money";
import { badgeFor, figures, lapseExpiredHolds, totalAvailable } from "./stock";
import { VIEWS } from "./studies";

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  material: string;
  description: string;
  status: "draft" | "published" | "archived";
  published_at: Date | null;
  featured_rank: number;
  version: number;
}

interface VariantRow {
  sku: string;
  product_id: string;
  colour: string;
  colour_slug: string;
  size_slug: string;
  height_cm: number;
  width_cm: number;
  depth_cm: number;
  weight_kg: number;
  price: number;
  compare_at: number | null;
  version: number;
  position: number;
}

export interface CatalogueEntry extends ProductRow {
  variants: (VariantRow & { available: number })[];
}

/** (compare-at − price) × 100 ÷ compare-at, half up; null without a compare-at price. */
export function savePercent(price: number, compareAt: number | null): number | null {
  return compareAt === null ? null : roundHalfUp((compareAt - price) * 100, compareAt);
}

export function sizeLabel(slug: string): string {
  return SIZE_LABELS[slug] ?? slug;
}

export function warrantyYears(category: string): number {
  if (category === "luggage") return config.warrantyYearsLuggage;
  return category === "backpacks" || category === "totes" ? config.warrantyYearsBags : config.warrantyYearsAccessories;
}

/** The product's cheapest variant; the first in seed order wins a tie. */
export function cardVariant<V extends { price: number }>(variants: V[]): V {
  const first = variants[0];
  if (!first) throw new Error("a product has at least one variant");
  return variants.reduce((best, v) => (v.price < best.price ? v : best), first);
}

export async function airlines(db: Queryable): Promise<(Frame & { weight_kg: number })[]> {
  return rows(db, "SELECT code, name, height_cm, width_cm, depth_cm, weight_kg FROM airlines ORDER BY position");
}

/** Products with their variants and live availability. Releases lapsed holds first. */
export async function loadCatalogue(db: Queryable, where: { slugs?: string[]; published?: boolean } = {}): Promise<CatalogueEntry[]> {
  await lapseExpiredHolds();
  const products = await rows<ProductRow>(
    db,
    `SELECT id, slug, name, category, material, description, status, published_at, featured_rank, version FROM products
     WHERE ($1::text[] IS NULL OR slug = ANY($1)) AND ($2::boolean IS NOT TRUE OR status = 'published') ORDER BY featured_rank`,
    [where.slugs ?? null, where.published ?? null],
  );
  if (products.length === 0) return [];
  const variants = await rows<VariantRow>(
    db,
    `SELECT sku, product_id, colour, colour_slug, size_slug, height_cm, width_cm, depth_cm, weight_kg, price, compare_at, version, position
     FROM variants WHERE product_id = ANY($1) ORDER BY product_id, position`,
    [products.map((p) => p.id)],
  );
  const stock = await figures(db, variants.map((v) => v.sku));
  return products.map((p) => ({
    ...p,
    variants: variants
      .filter((v) => v.product_id === p.id)
      .map((v) => ({ ...v, available: totalAvailable(stock.get(v.sku) ?? { bhiwandi: { available: 0, reserved: 0, committed: 0, dispatched: 0 }, gurugram: { available: 0, reserved: 0, committed: 0, dispatched: 0 } }) })),
  }));
}

export function productBadge(entry: CatalogueEntry): StockBadge {
  return badgeFor(entry.variants.reduce((sum, v) => sum + v.available, 0));
}

function studyImages(slug: string, name: string, colour: string, colourSlug: string): ProductImage[] {
  return VIEWS.map((view, index) => ({
    id: `study-${slug}-${colourSlug}-${view.toLowerCase()}`,
    url: `/media/studies/${slug}/${colourSlug}/${view.toLowerCase()}.svg`,
    alt: `${name} in ${colour}`,
    position: index + 1,
  }));
}

interface ImageRow {
  id: string;
  colour: string;
  alt: string;
}

/** Uploaded images first (newest first, position 1), then the four generated studies. */
export async function imagesFor(db: Queryable, entry: CatalogueEntry): Promise<Map<string, ProductImage[]>> {
  const uploaded = await rows<ImageRow>(db, "SELECT id, colour, alt FROM product_images WHERE product_id = $1 ORDER BY created_at DESC, id", [entry.id]);
  const byColour = new Map<string, ProductImage[]>();
  for (const v of entry.variants) {
    if (byColour.has(v.colour_slug)) continue;
    const own = uploaded.filter((i) => i.colour === v.colour).map((i) => ({ id: i.id, url: `/media/products/${i.id}`, alt: i.alt, position: 0 }));
    const all = [...own, ...studyImages(entry.slug, entry.name, v.colour, v.colour_slug)].map((image, index) => ({ ...image, position: index + 1 }));
    byColour.set(v.colour_slug, all);
  }
  return byColour;
}

export async function productDetail(db: Queryable, slug: string): Promise<Product | null> {
  const [entry] = await loadCatalogue(db, { slugs: [slug], published: true });
  if (!entry) return null;
  const images = await imagesFor(db, entry);
  const saves = await one<{ n: number }>(db, "SELECT count(*) AS n FROM wishlist_items WHERE product_id = $1", [entry.id]);
  const variants: Variant[] = entry.variants.map((v) => ({
    sku: v.sku,
    colour: v.colour,
    colour_slug: v.colour_slug,
    size: sizeLabel(v.size_slug),
    size_slug: v.size_slug,
    dimensions_cm: { height: v.height_cm, width: v.width_cm, depth: v.depth_cm },
    weight_kg: v.weight_kg,
    price: v.price,
    compare_at: v.compare_at,
    save_percent: savePercent(v.price, v.compare_at),
    available: v.available,
    badge: badgeFor(v.available),
    images: images.get(v.colour_slug) ?? [],
  }));
  return {
    slug: entry.slug,
    name: entry.name,
    category: entry.category,
    collection: entry.category,
    material: entry.material,
    badge: productBadge(entry),
    warranty_years: warrantyYears(entry.category),
    saves: saves?.n ?? 0,
    variants,
  };
}

export function fitsAirlines(entry: CatalogueEntry, frames: Frame[]): string[] {
  if (!hasCabinFit(entry.category)) return [];
  return frames
    .filter((frame) => entry.variants.some((v) => cabinFit(v.sku, { height: v.height_cm, width: v.width_cm, depth: v.depth_cm }, frame).fits))
    .map((frame) => frame.code);
}
