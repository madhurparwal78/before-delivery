import { asNumber, query, serverNow, withTransaction } from '../db.js';
import {
  holdActive,
  invalidTransition,
  notFound,
  storeSuspended,
  validationFailed,
} from '../http/errors.js';
import { bodyObject, integerField, param, requireRole } from '../http/context.js';
import type { RequestContext, SessionUser } from '../http/context.js';
import { json } from '../http/result.js';
import type { ApiResult } from '../http/result.js';
import { distanceKm, rankByDistance } from '../domain/ranking.js';
import { buildCart, loadHoldObject, loadStore, loadStores } from '../views.js';
import { createHold, releaseActiveHoldOfShopper, releaseHoldOnce } from '../holds.js';

const MAX_CART_LINES = 20;

export async function getCart(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'shopper');
  return json(await buildCart(session.userId, await serverNow()));
}

export async function putCartLine(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'shopper');
  const sku = param(context, 'sku');
  const known = await query(`SELECT sku FROM products WHERE operator_id = $1 AND sku = $2`, [
    session.operatorId,
    sku,
  ]);
  if (known.length === 0) throw notFound();

  const quantity = integerField(
    bodyObject(context),
    'quantity',
    0,
    999,
    'Enter a whole number from 0 to 999.',
  );

  await withTransaction(async (tx) => {
    await releaseActiveHoldOfShopper(tx, session.userId);
    if (quantity === 0) {
      await tx.query(`DELETE FROM cart_lines WHERE user_id = $1 AND sku = $2`, [
        session.userId,
        sku,
      ]);
      return;
    }
    const lineCount = asNumber(
      (await tx.query(`SELECT count(*) AS lines FROM cart_lines WHERE user_id = $1`, [session.userId]))
        .rows[0]!['lines'],
    );
    const existing = (
      await tx.query(`SELECT sku FROM cart_lines WHERE user_id = $1 AND sku = $2`, [
        session.userId,
        sku,
      ])
    ).rows.length;
    if (existing === 0 && lineCount >= MAX_CART_LINES) {
      throw validationFailed({ lines: 'A cart holds at most 20 lines.' });
    }
    await tx.query(
      `INSERT INTO cart_lines (user_id, sku, quantity) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, sku) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [session.userId, sku, quantity],
    );
  });

  return json(await buildCart(session.userId, await serverNow()));
}

export async function putCartStore(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'shopper');
  const fields = bodyObject(context);
  const storeId = fields['store_id'];
  if (typeof storeId !== 'string') throw validationFailed({ store_id: 'Choose a shop.' });
  const store = await loadStore(session.operatorId, storeId);
  if (!store) throw notFound();

  await withTransaction(async (tx) => {
    await releaseActiveHoldOfShopper(tx, session.userId);
    await tx.query(`UPDATE carts SET store_id = $2 WHERE user_id = $1`, [session.userId, storeId]);
  });

  return json(await buildCart(session.userId, await serverNow()));
}

export async function putCartArea(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'shopper');
  const fields = bodyObject(context);
  const errors: Record<string, string> = {};
  const lat = fields['lat'];
  const lon = fields['lon'];
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    errors['lat'] = 'Send a latitude from -90 to 90.';
  }
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    errors['lon'] = 'Send a longitude from -180 to 180.';
  }
  if (Object.keys(errors).length > 0) throw validationFailed(errors);

  await query(`UPDATE carts SET area_lat = $2, area_lon = $3 WHERE user_id = $1`, [
    session.userId,
    lat,
    lon,
  ]);
  return json(await buildCart(session.userId, await serverNow()));
}

export async function getCartShops(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'shopper');
  const now = await serverNow();
  const cart = await buildCart(session.userId, now);
  if (!cart.area) throw validationFailed({ area: 'Choose your area on a product page first.' });

  const skus = cart.lines.map((line) => line.sku);
  const stores = await loadStores(session.operatorId, '');
  const stockRows =
    skus.length === 0
      ? []
      : await query(
          `SELECT store_id, sku, on_hand, held FROM stock WHERE sku = ANY($1::text[])`,
          [skus],
        );

  const byStore = new Map<string, Map<string, { onHand: number; available: number }>>();
  for (const row of stockRows) {
    const storeId = row['store_id'] as string;
    if (!byStore.has(storeId)) byStore.set(storeId, new Map());
    byStore.get(storeId)!.set(row['sku'] as string, {
      onHand: asNumber(row['on_hand']),
      available: asNumber(row['on_hand']) - asNumber(row['held']),
    });
  }

  const candidates = stores.map((store) => {
    const stock = byStore.get(store.id) ?? new Map();
    let onHandSum = 0;
    let complete = true;
    for (const line of cart.lines) {
      const entry = stock.get(line.sku);
      onHandSum += entry?.onHand ?? 0;
      const ownHold =
        cart.hold && cart.hold.store_id === store.id
          ? (cart.hold.lines.find((held) => held.sku === line.sku)?.quantity ?? 0)
          : 0;
      if ((entry?.available ?? 0) + ownHold < line.quantity) complete = false;
    }
    return {
      storeId: store.id,
      distanceKm: distanceKm(cart.area!.lat, cart.area!.lon, store.lat, store.lon),
      onHandForTieBreak: onHandSum,
      name: store.name,
      complete,
    };
  });

  return json({
    shops: rankByDistance(candidates).map((entry) => ({
      store_id: entry.storeId,
      name: entry.name,
      distance_km: entry.distanceKm,
      complete: entry.complete,
    })),
  });
}

export async function postHold(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'shopper');
  const now = await serverNow();
  const cart = await buildCart(session.userId, now);

  if (cart.hold) throw holdActive(cart.hold.id);
  if (cart.lines.length === 0) throw validationFailed({ cart: 'Your cart is empty.' });
  if (!cart.store_id) throw validationFailed({ store_id: 'Choose a shop.' });

  const store = await loadStore(session.operatorId, cart.store_id);
  if (!store) throw notFound();
  if (store.suspended) throw storeSuspended(store.id);

  const holdId = await createHold(
    session.operatorId,
    session.userId,
    cart.store_id,
    cart.lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
  );
  return json(await loadHoldObject(holdId, await serverNow()), 201);
}

async function visibleHold(session: SessionUser, holdId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(holdId)) throw notFound();
  const rows = await query(`SELECT id FROM holds WHERE id = $1 AND user_id = $2`, [
    holdId,
    session.userId,
  ]);
  if (rows.length === 0) throw notFound();
}

export async function getHold(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'shopper');
  const holdId = param(context, 'id');
  await visibleHold(session, holdId);

  const row = (await query(`SELECT status, expires_at FROM holds WHERE id = $1`, [holdId]))[0]!;
  if (row['status'] === 'active' && (row['expires_at'] as Date).getTime() <= Date.now()) {
    await releaseHoldOnce(holdId, 'window_ended');
  }
  return json(await loadHoldObject(holdId, await serverNow()));
}

export async function deleteHold(context: RequestContext): Promise<ApiResult> {
  const session = requireRole(context, 'shopper');
  const holdId = param(context, 'id');
  await visibleHold(session, holdId);

  const before = (await query(`SELECT status FROM holds WHERE id = $1`, [holdId]))[0]!;
  if (before['status'] !== 'active') {
    throw invalidTransition(before['status'] as string, 'released');
  }
  await releaseHoldOnce(holdId, 'deleted');
  return json(await loadHoldObject(holdId, await serverNow()));
}
