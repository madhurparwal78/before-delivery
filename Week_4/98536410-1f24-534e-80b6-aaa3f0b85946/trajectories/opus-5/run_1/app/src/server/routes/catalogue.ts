import { asNumber, query, serverNow } from '../db.js';
import { notFound, validationFailed } from '../http/errors.js';
import { param, requireSession } from '../http/context.js';
import type { RequestContext } from '../http/context.js';
import { json } from '../http/result.js';
import type { ApiResult } from '../http/result.js';
import { distanceKm, rankByDistance } from '../domain/ranking.js';
import { loadStores, storeObject } from '../views.js';
import { trimmedQuery } from './stores.js';

export async function listProducts(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const text = trimmedQuery(context);
  const rows = await query(
    `SELECT sku, name, unit_price_milli FROM products
      WHERE operator_id = $1
        AND ($2 = '' OR strpos(tramela_fold(name), tramela_fold($2)) > 0
                     OR strpos(tramela_fold(sku), tramela_fold($2)) > 0)
      ORDER BY sku`,
    [session.operatorId, text],
  );
  const products = rows.map((row) => ({
    sku: row['sku'] as string,
    name: row['name'] as string,
    unit_price_milli: asNumber(row['unit_price_milli']),
  }));
  return json({ count: products.length, products });
}

export async function getProduct(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const rows = await query(
    `SELECT sku, name, unit_price_milli FROM products WHERE operator_id = $1 AND sku = $2`,
    [session.operatorId, param(context, 'sku')],
  );
  const row = rows[0];
  if (!row) throw notFound();
  return json({
    sku: row['sku'] as string,
    name: row['name'] as string,
    unit_price_milli: asNumber(row['unit_price_milli']),
  });
}

function readCoordinates(context: RequestContext): { lat: number; lon: number } {
  const errors: Record<string, string> = {};
  const lat = Number(context.url.searchParams.get('lat'));
  const lon = Number(context.url.searchParams.get('lon'));
  if (
    context.url.searchParams.get('lat') === null ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90
  ) {
    errors['lat'] = 'Send a latitude from -90 to 90.';
  }
  if (
    context.url.searchParams.get('lon') === null ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    errors['lon'] = 'Send a longitude from -180 to 180.';
  }
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  return { lat, lon };
}

export async function getAvailability(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const sku = param(context, 'sku');
  const known = await query(`SELECT sku FROM products WHERE operator_id = $1 AND sku = $2`, [
    session.operatorId,
    sku,
  ]);
  if (known.length === 0) throw notFound();

  const point = readCoordinates(context);
  const now = await serverNow();
  const stores = await loadStores(session.operatorId, '');
  const stockRows = await query(`SELECT store_id, on_hand, held FROM stock WHERE sku = $1`, [sku]);
  const stockByStore = new Map(
    stockRows.map((row) => [
      row['store_id'] as string,
      { onHand: asNumber(row['on_hand']), held: asNumber(row['held']) },
    ]),
  );

  const candidates = stores
    .filter((store) => stockByStore.has(store.id))
    .map((store) => {
      const stock = stockByStore.get(store.id)!;
      const view = storeObject(store, now);
      return {
        storeId: store.id,
        distanceKm: distanceKm(point.lat, point.lon, store.lat, store.lon),
        onHandForTieBreak: stock.onHand,
        shop: {
          store_id: store.id,
          name: store.name,
          city: store.city,
          distance_km: 0,
          on_hand: stock.onHand,
          held: stock.held,
          available: stock.onHand - stock.held,
          display_state: view.display_state,
          holdable: !store.suspended,
        },
      };
    });

  const ranked = rankByDistance(candidates).map((entry) => ({
    ...entry.shop,
    distance_km: entry.distanceKm,
  }));

  return json({ sku, lat: point.lat, lon: point.lon, shops: ranked });
}
