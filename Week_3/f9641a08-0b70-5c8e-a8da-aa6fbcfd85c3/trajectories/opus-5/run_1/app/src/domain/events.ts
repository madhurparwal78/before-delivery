import { Db } from '../db/pool';
import { publish } from '../services/live';
import { stockBadge } from './rules';
import { availableMap } from './stock';

export async function publishStockFor(client: Db, variantIds: string[]): Promise<void> {
  if (variantIds.length === 0) return;
  const unique = [...new Set(variantIds)];
  const rows = await client.query<{ id: string; sku: string; category: string }>(
    `SELECT v.id, v.sku, p.category FROM variants v JOIN products p ON p.id = v.product_id
     WHERE v.id = ANY($1::uuid[])`,
    [unique]
  );
  const available = await availableMap(client, unique);
  for (const row of rows) {
    const units = available.get(row.id) ?? 0;
    await publish(client, 'stock', { sku: row.sku, available: units, badge: stockBadge(units) });
  }
  const categories = [...new Set(rows.map((row) => row.category))];
  for (const slug of [...categories, 'all']) {
    const total = await client.one<{ total: string }>(
      `SELECT coalesce(sum(e.quantity), 0)::bigint AS total
       FROM stock_entries e
       JOIN variants v ON v.id = e.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE e.account = 'available' AND p.status = 'published'
         AND ($1 = 'all' OR p.category = $1)`,
      [slug]
    );
    await publish(client, 'collection', { slug, units: total === null ? 0 : Number(total.total) });
  }
}

export async function publishPriceFor(client: Db, variantId: string): Promise<void> {
  const row = await client.one<{ sku: string; price: number; compare_at: number | null }>(
    'SELECT sku, price, compare_at FROM variants WHERE id = $1',
    [variantId]
  );
  if (row === null) return;
  await publish(client, 'price', { sku: row.sku, price: row.price, compare_at: row.compare_at });
}

export async function publishCartCount(client: Db, userId: string | null, count: number): Promise<void> {
  if (userId === null) return;
  await publish(client, 'cart', { count }, { userId });
}

export async function publishWishlist(
  client: Db,
  userId: string | null,
  count: number,
  slugs: string[]
): Promise<void> {
  if (userId === null) return;
  await publish(client, 'wishlist', { count, slugs }, { userId });
}
