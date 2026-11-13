import { query, withTransaction } from "./db.js";
import { msUpsert, msDelete } from "./search.js";

interface DocRow {
  listing_id: string; product_id: string; title: string; brand: string; category: string;
  description: string; seller_id: string; seller_name: string; price_paise: string;
  rating: string; stock: number; status: string; created_seq: string; pincodes: string[];
}

/** Sync the whole live catalogue to the index. Safe to run repeatedly. */
export async function reindexAll(): Promise<void> {
  const rows = await query<DocRow>(`
    SELECT l.listing_id, l.product_id, p.title, p.brand, p.category, l.description, l.seller_id, s.name AS seller_name,
           l.price_paise, p.rating, l.stock, l.status, l.created_seq,
           (SELECT array_agg(pin.pincode) FROM pincodes pin
             WHERE pin.serviceable AND (s.ship_all_states OR s.ship_states @> ARRAY[pin.state])) AS pincodes
    FROM listings l JOIN products p ON p.product_id = l.product_id JOIN sellers s ON s.seller_id = l.seller_id
    WHERE l.status = 'live'`);
  for (const row of rows) {
    await msUpsert([{
      listing_id: row.listing_id, product_id: row.product_id, title: row.title, brand: row.brand,
      category: row.category, description: row.description, seller_id: row.seller_id,
      seller_name: row.seller_name, price_paise: Number(row.price_paise), rating: Number(row.rating),
      in_stock: row.stock > 0, pincodes: (row.pincodes ?? []).filter(Boolean),
      created_seq: Number(row.created_seq),
    }]);
  }
  const unlisted = await query<{ listing_id: string }>("SELECT listing_id FROM listings WHERE status <> 'live'");
  if (unlisted.length > 0) await msDelete(unlisted.map((r) => r.listing_id));
}

/** Sync one listing after a write commits (Postgres first, then the index). */
export async function syncListing(listingId: string): Promise<void> {
  const row = await query<DocRow>(`
    SELECT l.listing_id, l.product_id, p.title, p.brand, p.category, l.description, l.seller_id, s.name AS seller_name,
           l.price_paise, p.rating, l.stock, l.status, l.created_seq,
           (SELECT array_agg(pin.pincode) FROM pincodes pin
             WHERE pin.serviceable AND (s.ship_all_states OR s.ship_states @> ARRAY[pin.state])) AS pincodes
    FROM listings l JOIN products p ON p.product_id = l.product_id JOIN sellers s ON s.seller_id = l.seller_id
    WHERE l.listing_id = $1`, [listingId]);
  if (row.length === 0 || row[0].status !== "live") {
    await msDelete([listingId]);
    return;
  }
  await msUpsert([{
    listing_id: row[0].listing_id, product_id: row[0].product_id, title: row[0].title, brand: row[0].brand,
    category: row[0].category, description: row[0].description, seller_id: row[0].seller_id,
    seller_name: row[0].seller_name, price_paise: Number(row[0].price_paise), rating: Number(row[0].rating),
    in_stock: row[0].stock > 0, pincodes: (row[0].pincodes ?? []).filter(Boolean),
    created_seq: Number(row[0].created_seq),
  }]);
}

/** One background pass at a time, coordinated through Postgres so instances never duplicate work. */
export async function claimPass(kind: string, fn: () => Promise<void>): Promise<boolean> {
  return withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO rate_counters (bucket, window_start, count)
       VALUES ($1, now(), 0)
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN rate_counters.window_start < now() - interval '4 seconds' THEN 0 ELSE rate_counters.count END,
         window_start = CASE WHEN rate_counters.window_start < now() - interval '4 seconds' THEN now() ELSE rate_counters.window_start END
       WHERE rate_counters.window_start < now() - interval '4 seconds'
       RETURNING window_start`,
      [`pass:${kind}`],
    );
    if (res.rows.length === 0) return false;
    await fn();
    return true;
  });
}
