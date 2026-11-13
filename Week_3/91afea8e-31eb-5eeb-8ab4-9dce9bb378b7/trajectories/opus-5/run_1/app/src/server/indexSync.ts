/** Listing writes commit to Postgres first; this pass carries them into the search index. */

import { one, query } from './db.js';
import { deleteDocuments, ensureIndex, upsertDocuments, type IndexDocument } from './services/search.js';

const WATERMARK_KEY = 'search_watermark';

async function watermark(): Promise<string> {
  const row = await one<{ value: string }>(`SELECT value FROM app_state WHERE key = $1`, [
    WATERMARK_KEY,
  ]);
  return row === null ? '1970-01-01T00:00:00.000Z' : row.value;
}

async function setWatermark(value: string): Promise<void> {
  await query(
    `INSERT INTO app_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [WATERMARK_KEY, value],
  );
}

type SyncRow = {
  listing_id: string;
  product_id: string;
  title: string;
  brand: string;
  category: string;
  description: string;
  seller_id: string;
  seller_name: string;
  price_paise: number;
  rating: number;
  in_stock: boolean;
  pincodes: string[];
  created_seq: number;
  status: string;
  updated_at: string;
};

async function changedListings(since: string): Promise<SyncRow[]> {
  return query<SyncRow>(
    `SELECT l.id AS listing_id, l.product_id, p.title, p.brand, p.category_slug AS category,
            l.description, l.seller_id, s.display_name AS seller_name,
            CASE WHEN l.deal_price_paise IS NOT NULL AND l.deal_ends_at > now()
                 THEN l.deal_price_paise ELSE l.price_paise END AS price_paise,
            p.rating, (l.stock > 0) AS in_stock,
            COALESCE((SELECT array_agg(pin.pincode) FROM pincodes pin
                       WHERE pin.serviceable = true AND pin.state = ANY(s.ship_states)), ARRAY[]::text[])
              AS pincodes,
            l.created_seq, l.status, l.updated_at::text AS updated_at
       FROM listings l
       JOIN products p ON p.id = l.product_id
       JOIN sellers s ON s.id = l.seller_id
      WHERE l.updated_at > $1::timestamptz
         OR (l.deal_ends_at IS NOT NULL AND l.deal_ends_at > $1::timestamptz
             AND l.deal_ends_at <= now() + interval '1 minute')`,
    [since],
  );
}

export async function syncSearchIndex(): Promise<void> {
  if (!(await ensureIndex())) return;
  const since = await watermark();
  const rows = await changedListings(since);
  if (rows.length === 0) return;
  const live = rows.filter((row) => row.status === 'live');
  const gone = rows.filter((row) => row.status !== 'live');
  const documents: IndexDocument[] = live.map((row) => ({
    listing_id: row.listing_id,
    product_id: row.product_id,
    title: row.title,
    brand: row.brand,
    category: row.category,
    description: row.description,
    seller_id: row.seller_id,
    seller_name: row.seller_name,
    price_paise: row.price_paise,
    rating: row.rating,
    in_stock: row.in_stock,
    pincodes: row.pincodes,
    created_seq: row.created_seq,
  }));
  const upserted = await upsertDocuments(documents);
  const deleted = await deleteDocuments(gone.map((row) => row.listing_id));
  if (upserted && deleted) {
    const newest = rows
      .map((row) => new Date(row.updated_at).toISOString())
      .reduce((latest, value) => (value > latest ? value : latest), since);
    await setWatermark(newest);
  }
}

/** Rebuilds the whole index, used when the index is empty or new. */
export async function reindexAll(): Promise<void> {
  await setWatermark('1970-01-01T00:00:00.000Z');
  await syncSearchIndex();
}
