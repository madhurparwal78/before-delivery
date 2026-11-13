import { config } from '../config';
import { Db, db } from '../db/pool';
import { ProductDocument } from '../services/search';
import {
  AIRLINES,
  CATEGORY_LABELS,
  COLLECTIONS,
  PRICE_BANDS,
  SIZE_ORDER,
  priceBandSlugs
} from './constants';
import { cabinFit, hasCabinFit, savePercent, stockBadge } from './rules';
import { availableMap } from './stock';

export type VariantRecord = {
  id: string;
  sku: string;
  colour: string;
  colour_slug: string;
  size: string;
  size_slug: string;
  height_cm: number;
  width_cm: number;
  depth_cm: number;
  weight_kg: number;
  price: number;
  compare_at: number | null;
  position: number;
  version: number;
  available: number;
};

export type ImageRecord = {
  id: string;
  colour: string;
  alt: string;
  position: number;
  study: string | null;
};

export type ProductRecord = {
  id: string;
  slug: string;
  name: string;
  category: string;
  material: string;
  material_slug: string;
  description: string;
  status: string;
  featured_rank: number;
  published_at: Date;
  version: number;
  variants: VariantRecord[];
  images: ImageRecord[];
};

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  material: string;
  material_slug: string;
  description: string;
  status: string;
  featured_rank: number;
  published_at: Date;
  version: number;
};

type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  colour: string;
  colour_slug: string;
  size: string;
  size_slug: string;
  height_cm: string;
  width_cm: string;
  depth_cm: string;
  weight_kg: string;
  price: number;
  compare_at: number | null;
  position: number;
  version: number;
};

type ImageRow = {
  id: string;
  product_id: string;
  colour: string;
  alt: string;
  position: number;
  study: string | null;
};

export async function loadProducts(
  client: Db,
  options: { slug?: string; slugs?: string[]; statuses?: string[] } = {}
): Promise<ProductRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.slug !== undefined) {
    params.push(options.slug);
    conditions.push(`slug = $${params.length}`);
  }
  if (options.slugs !== undefined) {
    params.push(options.slugs);
    conditions.push(`slug = ANY($${params.length}::text[])`);
  }
  if (options.statuses !== undefined) {
    params.push(options.statuses);
    conditions.push(`status = ANY($${params.length}::text[])`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const products = await client.query<ProductRow>(
    `SELECT id, slug, name, category, material, material_slug, description, status,
            featured_rank, published_at, version
     FROM products ${where} ORDER BY featured_rank ASC`,
    params
  );
  if (products.length === 0) return [];
  const ids = products.map((product) => product.id);
  const variants = await client.query<VariantRow>(
    `SELECT * FROM variants WHERE product_id = ANY($1::uuid[]) ORDER BY position ASC`,
    [ids]
  );
  const images = await client.query<ImageRow>(
    `SELECT id, product_id, colour, alt, position, study FROM product_images
     WHERE product_id = ANY($1::uuid[]) ORDER BY colour ASC, position ASC`,
    [ids]
  );
  const available = await availableMap(client, variants.map((variant) => variant.id));

  return products.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    material: product.material,
    material_slug: product.material_slug,
    description: product.description,
    status: product.status,
    featured_rank: product.featured_rank,
    published_at: product.published_at,
    version: product.version,
    variants: variants
      .filter((variant) => variant.product_id === product.id)
      .map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        colour: variant.colour,
        colour_slug: variant.colour_slug,
        size: variant.size,
        size_slug: variant.size_slug,
        height_cm: Number(variant.height_cm),
        width_cm: Number(variant.width_cm),
        depth_cm: Number(variant.depth_cm),
        weight_kg: Number(variant.weight_kg),
        price: variant.price,
        compare_at: variant.compare_at,
        position: variant.position,
        version: variant.version,
        available: available.get(variant.id) ?? 0
      })),
    images: images
      .filter((image) => image.product_id === product.id)
      .map((image) => ({
        id: image.id,
        colour: image.colour,
        alt: image.alt,
        position: image.position,
        study: image.study
      }))
  }));
}

export function cardVariant(product: ProductRecord): VariantRecord {
  return product.variants.reduce((cheapest, variant) =>
    variant.price < cheapest.price ? variant : cheapest
  );
}

export function productAvailable(product: ProductRecord): number {
  return product.variants.reduce((sum, variant) => sum + variant.available, 0);
}

export function imageUrl(imageId: string): string {
  return `/media/products/${imageId}`;
}

export function colourOptions(product: ProductRecord): Array<{ name: string; slug: string; image_url: string }> {
  const seen = new Map<string, { name: string; slug: string; image_url: string }>();
  for (const variant of product.variants) {
    if (seen.has(variant.colour)) continue;
    const image = product.images
      .filter((item) => item.colour === variant.colour)
      .sort((a, b) => a.position - b.position)[0];
    seen.set(variant.colour, {
      name: variant.colour,
      slug: variant.colour_slug,
      image_url: image === undefined ? `/media/studies/${product.slug}/${variant.colour_slug}/1` : imageUrl(image.id)
    });
  }
  return [...seen.values()];
}

export function fitCodes(product: ProductRecord): string[] {
  if (!hasCabinFit(product.category)) return [];
  const codes = new Set<string>();
  for (const variant of product.variants) {
    for (const airline of AIRLINES) {
      const result = cabinFit(
        { height: variant.height_cm, width: variant.width_cm, depth: variant.depth_cm },
        airline
      );
      if (result.fits) codes.add(airline.code);
    }
  }
  return [...codes];
}

export function buildDocument(product: ProductRecord): ProductDocument {
  const card = cardVariant(product);
  const prices = new Set<string>();
  for (const variant of product.variants) {
    for (const band of priceBandSlugs(variant.price)) prices.add(band);
  }
  return {
    id: product.slug,
    slug: product.slug,
    name: product.name,
    skus: product.variants.map((variant) => variant.sku),
    colours: [...new Set(product.variants.map((variant) => variant.colour))],
    colour: [...new Set(product.variants.map((variant) => variant.colour_slug))],
    sizes: [...new Set(product.variants.map((variant) => variant.size))],
    size: [...new Set(product.variants.map((variant) => variant.size_slug))],
    size_cm: [
      ...new Set(
        product.variants.flatMap((variant) => [
          `${variant.height_cm} cm`,
          `${variant.width_cm} cm`,
          `${variant.depth_cm} cm`
        ])
      )
    ],
    category: product.category,
    collection: [product.category, 'all'],
    material: product.material,
    material_slug: [product.material_slug],
    description: product.description,
    price: [...prices],
    fit: fitCodes(product),
    min_price: card.price,
    price_varies: new Set(product.variants.map((variant) => variant.price)).size > 1,
    compare_at: card.compare_at,
    save_percent: savePercent(card.price, card.compare_at),
    badge: stockBadge(productAvailable(product)),
    colour_options: colourOptions(product),
    published_at: product.published_at.getTime(),
    featured_rank: product.featured_rank
  };
}

export type SearchResultItem = {
  slug: string;
  name: string;
  category: string;
  min_price: number;
  price_varies: boolean;
  compare_at: number | null;
  save_percent: number | null;
  colours: Array<{ name: string; slug: string; image_url: string }>;
  badge: string;
};

export function resultFromDocument(document: ProductDocument): SearchResultItem {
  return {
    slug: document.slug,
    name: document.name,
    category: document.category,
    min_price: document.min_price,
    price_varies: document.price_varies,
    compare_at: document.compare_at,
    save_percent: document.save_percent,
    colours: document.colour_options,
    badge: document.badge
  };
}

export type CatalogueFilters = {
  q: string;
  collection: string;
  category: string[];
  colour: string[];
  size: string[];
  material: string[];
  price: string[];
  fit: string[];
  sort: string;
  page: number;
};

export const FILTER_GROUPS = ['category', 'colour', 'size', 'material', 'price', 'fit'] as const;
export type FilterGroup = (typeof FILTER_GROUPS)[number];

export function documentMatchesGroup(document: ProductDocument, group: FilterGroup, values: string[]): boolean {
  if (values.length === 0) return true;
  switch (group) {
    case 'category':
      return values.includes(document.category);
    case 'colour':
      return document.colour.some((value) => values.includes(value));
    case 'size':
      return document.size.some((value) => values.includes(value));
    case 'material':
      return document.material_slug.some((value) => values.includes(value));
    case 'price':
      return document.price.some((value) => values.includes(value));
    case 'fit':
      return document.fit.some((value) => values.includes(value));
    default:
      return true;
  }
}

export function documentValues(document: ProductDocument, group: FilterGroup): string[] {
  switch (group) {
    case 'category':
      return [document.category];
    case 'colour':
      return document.colour;
    case 'size':
      return document.size;
    case 'material':
      return document.material_slug;
    case 'price':
      return document.price;
    case 'fit':
      return document.fit;
    default:
      return [];
  }
}

export function documentMatchesText(document: ProductDocument, text: string): boolean {
  if (text.trim() === '') return true;
  const needle = text.trim().toLowerCase();
  if (document.name.toLowerCase().includes(needle)) return true;
  return document.skus.some((sku) => sku.toLowerCase().includes(needle));
}

export function sortDocuments(documents: ProductDocument[], sort: string): ProductDocument[] {
  const sorted = [...documents];
  const byName = (a: ProductDocument, b: ProductDocument): number => a.name.localeCompare(b.name);
  if (sort === 'price-asc') sorted.sort((a, b) => a.min_price - b.min_price || byName(a, b));
  else if (sort === 'price-desc') sorted.sort((a, b) => b.min_price - a.min_price || byName(a, b));
  else if (sort === 'newest') sorted.sort((a, b) => b.published_at - a.published_at || byName(a, b));
  else sorted.sort((a, b) => a.featured_rank - b.featured_rank || byName(a, b));
  return sorted;
}

export async function publishedDocuments(client: Db = db): Promise<ProductDocument[]> {
  const products = await loadProducts(client, { statuses: ['published'] });
  return products.map(buildDocument);
}

export type FilterOption = { value: string; label: string; count: number | null };

export function optionsForGroup(group: FilterGroup, present: Set<string>): FilterOption[] {
  const list: FilterOption[] = [];
  if (group === 'category') {
    for (const slug of ['luggage', 'backpacks', 'totes', 'wallets', 'accessories']) {
      if (present.has(slug)) list.push({ value: slug, label: CATEGORY_LABELS[slug], count: null });
    }
    return list;
  }
  if (group === 'size') {
    for (const size of SIZE_ORDER) {
      if (present.has(size.slug)) list.push({ value: size.slug, label: size.label, count: null });
    }
    return list;
  }
  if (group === 'price') {
    for (const band of PRICE_BANDS) {
      if (present.has(band.slug)) list.push({ value: band.slug, label: band.label, count: null });
    }
    return list;
  }
  if (group === 'fit') {
    for (const airline of AIRLINES) {
      if (present.has(airline.code)) list.push({ value: airline.code, label: airline.name, count: null });
    }
    return list;
  }
  return list;
}

export async function collectionsPayload(
  client: Db = db
): Promise<Array<{ slug: string; name: string; designs: number; units: number }>> {
  const products = await loadProducts(client, { statuses: ['published'] });
  return COLLECTIONS.map((collection) => {
    const inCollection =
      collection.slug === 'all' ? products : products.filter((product) => product.category === collection.slug);
    return {
      slug: collection.slug,
      name: collection.name,
      designs: inCollection.length,
      units: inCollection.reduce((sum, product) => sum + productAvailable(product), 0)
    };
  });
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / config.pageSize));
}
