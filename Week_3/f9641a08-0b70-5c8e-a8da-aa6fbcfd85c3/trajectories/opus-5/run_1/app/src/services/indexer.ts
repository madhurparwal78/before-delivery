import { Db, db } from '../db/pool';
import { buildDocument, loadProducts } from '../domain/catalogue';
import { deleteDocuments, ensureIndex, upsertDocuments } from './search';

let indexReady = false;
let flushing = false;

export async function queueProduct(client: Db, productId: string): Promise<void> {
  await client.query(
    `INSERT INTO search_index_queue (product_id, queued_at) VALUES ($1, now())
     ON CONFLICT (product_id) DO UPDATE SET queued_at = now()`,
    [productId]
  );
}

export async function queueAllProducts(client: Db = db): Promise<void> {
  await client.query(
    `INSERT INTO search_index_queue (product_id, queued_at)
     SELECT id, now() FROM products
     ON CONFLICT (product_id) DO UPDATE SET queued_at = now()`
  );
}

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const rows = await db.query<{ product_id: string }>(
      'SELECT product_id FROM search_index_queue ORDER BY queued_at ASC LIMIT 200'
    );
    if (rows.length === 0) return;
    if (!indexReady) {
      await ensureIndex();
      indexReady = true;
    }
    const ids = rows.map((row) => row.product_id);
    const products = await loadProducts(db, {});
    const selected = products.filter((product) => ids.includes(product.id));
    const published = selected.filter((product) => product.status === 'published');
    const unpublished = selected.filter((product) => product.status !== 'published');
    await upsertDocuments(published.map(buildDocument));
    await deleteDocuments(unpublished.map((product) => product.slug));
    const handled = selected.map((product) => product.id);
    await db.query('DELETE FROM search_index_queue WHERE product_id = ANY($1::uuid[])', [handled]);
    const missing = ids.filter((id) => !handled.includes(id));
    if (missing.length > 0) {
      await db.query('DELETE FROM search_index_queue WHERE product_id = ANY($1::uuid[])', [missing]);
    }
  } catch {
    indexReady = false;
  } finally {
    flushing = false;
  }
}

export function startIndexer(): void {
  setInterval(() => {
    void flush();
  }, 500);
  void flush();
}
