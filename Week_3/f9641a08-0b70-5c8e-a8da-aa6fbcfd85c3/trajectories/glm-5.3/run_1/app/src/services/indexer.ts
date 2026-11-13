import type { Client } from '../db/pool.js';
import { buildDoc, pushDocs, deleteDoc, type ProductDoc } from './search.js';
import type { DbProductRow, DbVariantRow } from './search.js';
import { AIRLINES } from './airlines.js';

/**
 * Keeps the search index in step with the catalogue. Only published products
 * are ever pushed; archived and draft ones are removed.
 */
export async function pushDoc(client: Client, slug: string): Promise<void> {
  const product = await client.query<DbProductRow>(
    `SELECT slug, name, category, material, description, featured_rank, published_at, status FROM products WHERE slug = $1`, [slug]);
  if (product.rows.length === 0) {
    await deleteDoc(slug);
    return;
  }
  if (product.rows[0].status !== 'published') {
    await deleteDoc(slug);
    return;
  }
  const variants = await client.query<DbVariantRow>(
    `SELECT sku, product_slug, colour, colour_slug, size, size_slug, height_cm, width_cm, depth_cm, price, compare_at
     FROM variants WHERE product_slug = $1 ORDER BY position`, [slug]);
  const fitCodes: string[] = [];
  for (const airline of AIRLINES) {
    if (variants.rows.some((v) => v.height_cm <= airline.height_cm && v.width_cm <= airline.width_cm && v.depth_cm <= airline.depth_cm)) {
      fitCodes.push(airline.code);
    }
  }
  const doc = buildDoc(product.rows[0], variants.rows, fitCodes);
  await pushDocs([doc]);
}

export async function pushAll(client: Client): Promise<void> {
  const products = await client.query<DbProductRow>(
    `SELECT slug, name, category, material, description, featured_rank, published_at, status FROM products WHERE status = 'published' ORDER BY featured_rank`);
  const docs: ProductDoc[] = [];
  for (const product of products.rows) {
    const variants = await client.query<DbVariantRow>(
      `SELECT sku, product_slug, colour, colour_slug, size, size_slug, height_cm, width_cm, depth_cm, price, compare_at
       FROM variants WHERE product_slug = $1 ORDER BY position`, [product.slug]);
    const fitCodes: string[] = [];
    for (const airline of AIRLINES) {
      if (variants.rows.some((v) => v.height_cm <= airline.height_cm && v.width_cm <= airline.width_cm && v.depth_cm <= airline.depth_cm)) {
        fitCodes.push(airline.code);
      }
    }
    docs.push(buildDoc(product, variants.rows, fitCodes));
  }
  if (docs.length > 0) await pushDocs(docs);
}

export async function unindexDoc(slug: string): Promise<void> {
  await deleteDoc(slug);
}
