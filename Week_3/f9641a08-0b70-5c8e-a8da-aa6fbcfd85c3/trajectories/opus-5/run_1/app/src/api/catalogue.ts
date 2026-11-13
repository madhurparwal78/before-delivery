import { config, publicConfig } from '../config';
import { Db, db } from '../db/pool';
import { FIELD_COPY, notFound, validationFailed } from '../errors';
import { sendBytes, sendJson } from '../http/respond';
import { route } from '../http/router';
import {
  ProductRecord,
  collectionsPayload,
  imageUrl,
  loadProducts,
  productAvailable
} from '../domain/catalogue';
import { AIRLINES, COLLECTIONS, findAirline, warrantyYearsFor } from '../domain/constants';
import { cabinFit, hasCabinFit, stockBadge } from '../domain/rules';
import { catalogueSearch, catalogueSuggest, parseFilters } from '../domain/search-query';
import { renderStudy } from '../domain/studies';
import { searchReachable } from '../services/search';
import { storageReachable, getObject } from '../services/storage';

export type VariantPayload = {
  sku: string;
  colour: string;
  colour_slug: string;
  size: string;
  size_slug: string;
  dimensions_cm: { height: number; width: number; depth: number };
  weight_kg: number;
  price: number;
  compare_at: number | null;
  available: number;
  badge: string;
  images: Array<{ id: string; url: string; alt: string; position: number }>;
};

export type ProductPayload = {
  slug: string;
  name: string;
  category: string;
  collection: string;
  material: string;
  warranty_years: number;
  saves: number;
  variants: VariantPayload[];
};

export async function savesCount(client: Db, productId: string): Promise<number> {
  const row = await client.one<{ total: string }>(
    'SELECT count(*)::bigint AS total FROM wishlist_items WHERE product_id = $1',
    [productId]
  );
  return row === null ? 0 : Number(row.total);
}

export function productPayload(product: ProductRecord, saves: number): ProductPayload {
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    collection: product.category,
    material: product.material,
    warranty_years: warrantyYearsFor(product.category),
    saves,
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      colour: variant.colour,
      colour_slug: variant.colour_slug,
      size: variant.size,
      size_slug: variant.size_slug,
      dimensions_cm: { height: variant.height_cm, width: variant.width_cm, depth: variant.depth_cm },
      weight_kg: variant.weight_kg,
      price: variant.price,
      compare_at: variant.compare_at,
      available: variant.available,
      badge: stockBadge(variant.available),
      images: product.images
        .filter((image) => image.colour === variant.colour)
        .sort((a, b) => a.position - b.position)
        .map((image) => ({
          id: image.id,
          url: imageUrl(image.id),
          alt: image.alt,
          position: image.position
        }))
    }))
  };
}

export async function loadPublishedProduct(slug: string): Promise<ProductRecord> {
  const [product] = await loadProducts(db, { slug, statuses: ['published'] });
  if (product === undefined) throw notFound();
  return product;
}

export function registerCatalogueRoutes(): void {
  route('GET', '/api/health', 'api', async (ctx) => {
    const [search, storage] = await Promise.all([searchReachable(), storageReachable()]);
    sendJson(ctx, 200, { status: search && storage ? 'ok' : 'unavailable' });
  });

  route('GET', '/api/config', 'api', async (ctx) => {
    sendJson(ctx, 200, publicConfig());
  });

  route('GET', '/api/collections', 'api', async (ctx) => {
    sendJson(ctx, 200, await collectionsPayload(db));
  });

  route('GET', '/api/airlines', 'api', async (ctx) => {
    sendJson(ctx, 200, AIRLINES);
  });

  route('GET', '/api/fit', 'api', async (ctx) => {
    const airlineCode = ctx.query.get('airline') ?? '';
    const sku = ctx.query.get('sku') ?? '';
    const fields: Record<string, string> = {};
    const airline = findAirline(airlineCode);
    if (airline === null) fields.airline = FIELD_COPY.airline;
    const row = await db.one<{
      sku: string;
      height_cm: string;
      width_cm: string;
      depth_cm: string;
      category: string;
      status: string;
    }>(
      `SELECT v.sku, v.height_cm, v.width_cm, v.depth_cm, p.category, p.status
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = $1`,
      [sku]
    );
    if (row === null || row.status !== 'published' || !hasCabinFit(row.category)) {
      fields.sku = FIELD_COPY.fitSku;
    }
    if (Object.keys(fields).length > 0) throw validationFailed(fields);
    const result = cabinFit(
      { height: Number(row!.height_cm), width: Number(row!.width_cm), depth: Number(row!.depth_cm) },
      airline!
    );
    sendJson(ctx, 200, {
      sku: row!.sku,
      airline: airline!.code,
      fits: result.fits,
      overhang_cm: result.overhang_cm,
      max_overhang_cm: result.max_overhang_cm,
      verdict: result.verdict
    });
  });

  route('GET', '/api/search', 'api', async (ctx) => {
    const collectionRaw = ctx.query.get('collection') ?? 'all';
    const collection = COLLECTIONS.some((item) => item.slug === collectionRaw) ? collectionRaw : 'all';
    const filters = parseFilters(ctx.query, collection);
    const result = await catalogueSearch(filters);
    sendJson(ctx, 200, {
      mode: result.mode,
      total: result.total,
      page: result.page,
      page_size: result.page_size,
      results: result.results,
      facets: result.facets,
      notice: result.notice
    });
  });

  route('GET', '/api/search/suggest', 'api', async (ctx) => {
    const result = await catalogueSuggest(ctx.query.get('q') ?? '');
    sendJson(ctx, 200, result);
  });

  route('GET', '/api/products/:slug', 'api', async (ctx) => {
    const product = await loadPublishedProduct(ctx.params.slug);
    sendJson(ctx, 200, productPayload(product, await savesCount(db, product.id)));
  });

  route('GET', '/api/variants/:sku/stock', 'api', async (ctx) => {
    const row = await db.one<{ id: string; sku: string }>(
      `SELECT v.id, v.sku FROM variants v JOIN products p ON p.id = v.product_id
       WHERE v.sku = $1 AND p.status = 'published'`,
      [ctx.params.sku]
    );
    if (row === null) throw notFound();
    const totals = await db.one<{ total: string }>(
      `SELECT coalesce(sum(quantity), 0)::bigint AS total FROM stock_entries
       WHERE variant_id = $1 AND account = 'available'`,
      [row.id]
    );
    const available = totals === null ? 0 : Number(totals.total);
    sendJson(ctx, 200, { sku: row.sku, available, badge: stockBadge(available) });
  });

  route('GET', '/media/products/:id', 'raw', async (ctx) => {
    const image = await db.one<{
      id: string;
      colour: string;
      study: string | null;
      content_type: string;
      storage_key: string | null;
      category: string;
    }>(
      `SELECT i.id, i.colour, i.study, i.content_type, i.storage_key, p.category
       FROM product_images i JOIN products p ON p.id = i.product_id WHERE i.id = $1`,
      [ctx.params.id]
    );
    if (image === null) throw notFound();
    if (image.storage_key === null) {
      const svg = renderStudy({
        category: image.category,
        colour: image.colour,
        study: image.study ?? 'Front'
      });
      sendBytes(ctx, 200, Buffer.from(svg, 'utf8'), 'image/svg+xml', { 'Cache-Control': 'public, max-age=300' });
      return;
    }
    const bytes = await getObject(image.storage_key);
    if (bytes === null) throw notFound();
    sendBytes(ctx, 200, bytes, image.content_type, { 'Cache-Control': 'public, max-age=300' });
  });

  route('GET', '/media/studies/:slug/:colour/:index', 'raw', async (ctx) => {
    const row = await db.one<{ category: string; colour: string }>(
      `SELECT p.category, v.colour FROM products p JOIN variants v ON v.product_id = p.id
       WHERE p.slug = $1 AND v.colour_slug = $2 LIMIT 1`,
      [ctx.params.slug, ctx.params.colour]
    );
    if (row === null) throw notFound();
    const index = Number(ctx.params.index);
    const studies = ['Front', 'Side', 'Back', 'Open'];
    const svg = renderStudy({
      category: row.category,
      colour: row.colour,
      study: studies[(Number.isInteger(index) ? index - 1 : 0) % 4] ?? 'Front'
    });
    sendBytes(ctx, 200, Buffer.from(svg, 'utf8'), 'image/svg+xml', { 'Cache-Control': 'public, max-age=300' });
  });

  route('GET', '/media/masthead/:index', 'raw', async (ctx) => {
    const products = await loadProducts(db, { statuses: ['published'] });
    const index = Math.max(0, Number(ctx.params.index) - 1) % Math.max(1, products.length);
    const product = products[index];
    const svg = renderStudy({
      category: product === undefined ? 'luggage' : product.category,
      colour: product === undefined ? 'Graphite' : product.variants[0].colour,
      study: ['Front', 'Side', 'Back', 'Open'][index % 4],
      grey: true
    });
    sendBytes(ctx, 200, Buffer.from(svg, 'utf8'), 'image/svg+xml', { 'Cache-Control': 'public, max-age=300' });
  });
}

export function cabinFitFor(
  variant: { height_cm: number; width_cm: number; depth_cm: number },
  airlineCode: string
): { fits: boolean; verdict: string; max_overhang_cm: number } | null {
  const airline = findAirline(airlineCode);
  if (airline === null) return null;
  const result = cabinFit(
    { height: variant.height_cm, width: variant.width_cm, depth: variant.depth_cm },
    airline
  );
  return { fits: result.fits, verdict: result.verdict, max_overhang_cm: result.max_overhang_cm };
}

export function productUnits(product: ProductRecord): number {
  return productAvailable(product);
}

export const PAGE_SIZE = config.pageSize;
