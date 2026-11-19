// The shopper's cart, kept on the server: lines, area, chosen shop and the hold on them.
import { type Db, one, pool, query, required, transaction } from "./db.js";
import { ApiError, FieldErrors, forbidden, validationFailed } from "./errors.js";

import { lineTotalCents, vatCents } from "./money.js";
import { rankByDistance } from "./ranking.js";
import { requireProduct } from "./catalogue.js";
import { HOLD_COLUMNS, type HoldRow, activeHold, createHold, holdLines, holdObject, releaseHold, windowEnded } from "./holds.js";
import { requireShop, loadShops } from "./shops.js";
import type { SessionUser } from "./auth.js";

export const CART_MAX_QUANTITY = 999;
const CART_MAX_LINES = 20;

interface CartRow {
  store_id: string | null;
  area_lat: number | null;
  area_lon: number | null;
  hold_id: string | null;
}

export function requireShopper(user: SessionUser): void {
  if (user.role !== "shopper") throw forbidden();
}

async function ensureCart(db: Db, userId: string): Promise<void> {
  await db.query("INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
}

async function cartRow(db: Pick<Db, "query">, userId: string): Promise<CartRow> {
  const row = await one<CartRow>(db, "SELECT store_id, area_lat, area_lon, hold_id FROM carts WHERE user_id = $1", [userId]);
  return row ?? { store_id: null, area_lat: null, area_lon: null, hold_id: null };
}

interface CartLineRow {
  sku: string;
  name: string;
  quantity: number;
  unit_price_milli: number;
}

async function cartLines(db: Pick<Db, "query">, userId: string): Promise<CartLineRow[]> {
  return query<CartLineRow>(db,
    `SELECT l.sku, p.name, l.quantity, p.unit_price_milli FROM cart_lines l JOIN products p ON p.sku = l.sku
     WHERE l.user_id = $1 ORDER BY l.added_at, l.sku`, [userId]);
}

/** Loads the hold linked to the cart, releasing it first when its window has ended. */
async function linkedHold(cart: CartRow, now: Date): Promise<HoldRow | null> {
  if (!cart.hold_id) return null;
  const hold = await one<HoldRow>(pool, `SELECT ${HOLD_COLUMNS} FROM holds WHERE id = $1`, [cart.hold_id]);
  if (!hold) return null;
  if (hold.status === "active" && windowEnded(hold, now)) {
    await transaction((db) => releaseHold(db, hold.id, "window_ended", now));
    return (await one<HoldRow>(pool, `SELECT ${HOLD_COLUMNS} FROM holds WHERE id = $1`, [hold.id])) ?? null;
  }
  return hold.status === "converted" ? null : hold;
}

export async function cartObject(user: SessionUser, now: Date) {
  const cart = await cartRow(pool, user.id);
  const lines = await cartLines(pool, user.id);
  const hold = await linkedHold(cart, now);
  const shop = cart.store_id ? await requireShop(pool, user, cart.store_id) : null;
  const stock = new Map<string, { on_hand: number; held: number }>();
  if (shop) {
    for (const row of await query<{ sku: string; on_hand: number; held: number }>(pool, "SELECT sku, on_hand, held FROM stock WHERE store_id = $1", [shop.id])) {
      stock.set(row.sku, row);
    }
  }
  const ownHeld = new Map<string, number>();
  if (hold && hold.status === "active" && shop && hold.store_id === shop.id) {
    for (const line of await holdLines(pool, hold.id)) ownHeld.set(line.sku, line.quantity);
  }
  let total = 0;
  let vat = 0;
  let units = 0;
  const shown = lines.map((line) => {
    const lineTotal = lineTotalCents(line.quantity, line.unit_price_milli);
    const lineVat = shop ? vatCents(lineTotal, shop.vat_rate) : null;
    const row = stock.get(line.sku);
    const available = shop ? (row ? row.on_hand - row.held : 0) + (ownHeld.get(line.sku) ?? 0) : null;
    const short = available !== null && available < line.quantity;
    if (!short) {
      total += lineTotal;
      vat += lineVat ?? 0;
      units += line.quantity;
    }
    return {
      sku: line.sku, name: line.name, quantity: line.quantity, unit_price_milli: line.unit_price_milli,
      line_total_cents: lineTotal, vat_cents: lineVat, available, status: short ? "short" : "ok",
    };
  });
  return {
    store_id: shop?.id ?? null, store_name: shop?.name ?? null,
    area: cart.area_lat !== null && cart.area_lon !== null ? { lat: cart.area_lat, lon: cart.area_lon } : null,
    lines: shown, total_cents: total, vat_cents: shop ? vat : null, units,
    hold: hold ? await holdObject(pool, hold, now) : null,
  };
}

/** Any change to lines or shop first releases an active hold, in the same transaction as the change. */
async function changeCart(user: SessionUser, now: Date, change: (db: Db) => Promise<void>): Promise<void> {
  await transaction(async (db) => {
    await ensureCart(db, user.id);
    await db.query("SELECT 1 FROM carts WHERE user_id = $1 FOR UPDATE", [user.id]);
    const active = await activeHold(db, user.id);
    if (active) await releaseHold(db, active.id, "cart_changed", now);
    await db.query("UPDATE carts SET hold_id = NULL WHERE user_id = $1", [user.id]);
    await change(db);
  });
}

export async function putLine(user: SessionUser, sku: string, input: Record<string, unknown> | null, now: Date) {
  const product = await requireProduct(user, sku);
  requireShopper(user);
  const quantity = input?.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0 || quantity > CART_MAX_QUANTITY) {
    throw validationFailed({ quantity: `Use a whole number from 0 to ${CART_MAX_QUANTITY}.` });
  }
  await changeCart(user, now, async (db) => {
    if (quantity === 0) {
      await db.query("DELETE FROM cart_lines WHERE user_id = $1 AND sku = $2", [user.id, product.sku]);
      return;
    }
    const existing = await required<{ n: number }>(db, "SELECT count(*)::int AS n FROM cart_lines WHERE user_id = $1 AND sku <> $2", [user.id, product.sku]);
    if (existing.n >= CART_MAX_LINES) throw validationFailed({ lines: `A cart holds at most ${CART_MAX_LINES} lines.` });
    await db.query(
      `INSERT INTO cart_lines (user_id, sku, quantity, added_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, sku) DO UPDATE SET quantity = EXCLUDED.quantity`, [user.id, product.sku, quantity, now]);
  });
  return cartObject(user, now);
}

export async function putShop(user: SessionUser, input: Record<string, unknown> | null, now: Date) {
  const shop = await requireShop(pool, user, input?.store_id);
  requireShopper(user);
  await changeCart(user, now, async (db) => {
    await db.query("UPDATE carts SET store_id = $2 WHERE user_id = $1", [user.id, shop.id]);
  });
  return cartObject(user, now);
}

export async function putArea(user: SessionUser, input: Record<string, unknown> | null, now: Date) {
  requireShopper(user);
  const errors = new FieldErrors();
  const lat = input?.lat;
  const lon = input?.lon;
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) errors.add("lat", "Give a latitude from -90 to 90.");
  if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) errors.add("lon", "Give a longitude from -180 to 180.");
  errors.throwIfAny();
  await pool.query(
    `INSERT INTO carts (user_id, area_lat, area_lon) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET area_lat = EXCLUDED.area_lat, area_lon = EXCLUDED.area_lon`, [user.id, lat, lon]);
  return cartObject(user, now);
}

export async function cartShops(user: SessionUser, now: Date) {
  requireShopper(user);
  const cart = await cartRow(pool, user.id);
  if (cart.area_lat === null || cart.area_lon === null) throw validationFailed({ area: "Choose your area on a product page first." });
  const lines = await cartLines(pool, user.id);
  const hold = await linkedHold(cart, now);
  const ownHeld = new Map<string, number>();
  if (hold && hold.status === "active") for (const line of await holdLines(pool, hold.id)) ownHeld.set(line.sku, line.quantity);
  const all = await loadShops(pool, user.operatorId);
  const stock = await query<{ store_id: string; sku: string; on_hand: number; held: number }>(pool,
    "SELECT store_id, sku, on_hand, held FROM stock WHERE sku = ANY($1::text[])", [lines.map((line) => line.sku)]);
  const candidates = all.map((shop) => {
    const rows = new Map(stock.filter((row) => row.store_id === shop.id).map((row) => [row.sku, row]));
    const here = hold?.status === "active" && hold.store_id === shop.id;
    const complete = lines.every((line) => {
      const row = rows.get(line.sku);
      return (row ? row.on_hand - row.held : 0) + (here ? ownHeld.get(line.sku) ?? 0 : 0) >= line.quantity;
    });
    return { ...shop, onHand: lines.reduce((sum, line) => sum + (rows.get(line.sku)?.on_hand ?? 0), 0), complete };
  });
  return {
    shops: rankByDistance(candidates, cart.area_lat, cart.area_lon).map(({ shop, distanceKm }) => ({
      store_id: shop.id, name: shop.name, distance_km: distanceKm, complete: shop.complete,
    })),
  };
}

export async function placeHold(user: SessionUser, now: Date) {
  requireShopper(user);
  const existing = await activeHold(pool, user.id);
  if (existing && !windowEnded(existing, now)) throw new ApiError(409, "hold_active", { hold_id: existing.id });
  const cart = await cartRow(pool, user.id);
  const lines = await cartLines(pool, user.id);
  const errors = new FieldErrors();
  if (lines.length === 0) errors.add("cart", "The cart is empty.");
  if (!cart.store_id) errors.add("store_id", "Choose a collection shop first.");
  errors.throwIfAny();
  const shop = await requireShop(pool, user, cart.store_id);
  if (shop.suspended) throw new ApiError(409, "store_suspended", { store_id: shop.id });
  const hold = await transaction(async (db) => {
    if (existing) await releaseHold(db, existing.id, "window_ended", now);
    return createHold(db, user, shop.id, lines.map((line) => ({ sku: line.sku, quantity: line.quantity })), now);
  });
  return holdObject(pool, hold, now);
}


