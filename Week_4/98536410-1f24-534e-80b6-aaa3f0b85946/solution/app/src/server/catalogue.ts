import { pool, query } from "./db.js";
import { notFound, validationFailed } from "./errors.js";
import { byCodePoint } from "./json.js";
import { rankByDistance } from "./ranking.js";
import { matchesLiterally } from "./search.js";
import type { SessionUser } from "./auth.js";
import { displayStateOf, loadShops } from "./shops.js";

interface ProductRow {
  sku: string;
  name: string;
  unit_price_milli: number;
}

export function productObject(product: ProductRow) {
  return { sku: product.sku, name: product.name, unit_price_milli: product.unit_price_milli };
}

export async function loadProducts(user: Pick<SessionUser, "operatorId">): Promise<ProductRow[]> {
  const rows = await query<ProductRow>(pool, "SELECT sku, name, unit_price_milli FROM products WHERE operator_id = $1", [user.operatorId]);
  return rows.sort((a, b) => byCodePoint(a.sku, b.sku));
}

export async function listProducts(user: SessionUser, term: string) {
  const products = (await loadProducts(user)).filter((product) => matchesLiterally(term, [product.name, product.sku]));
  return { count: products.length, products: products.map(productObject) };
}

export async function requireProduct(user: Pick<SessionUser, "operatorId">, sku: unknown): Promise<ProductRow> {
  const found = typeof sku === "string" ? (await loadProducts(user)).find((product) => product.sku === sku) : undefined;
  if (!found) throw notFound();
  return found;
}

function coordinate(raw: string | null, low: number, high: number): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= low && value <= high ? value : null;
}

export async function availability(user: SessionUser, sku: string, rawLat: string | null, rawLon: string | null, now: Date) {
  const product = await requireProduct(user, sku);
  const lat = coordinate(rawLat, -90, 90);
  const lon = coordinate(rawLon, -180, 180);
  const errors: Record<string, string> = {};
  if (lat === null) errors.lat = "Give a latitude from -90 to 90.";
  if (lon === null) errors.lon = "Give a longitude from -180 to 180.";
  if (lat === null || lon === null) throw validationFailed(errors);
  const all = await loadShops(pool, user.operatorId);
  const stock = new Map((await query<{ store_id: string; on_hand: number; held: number }>(pool,
    "SELECT store_id, on_hand, held FROM stock WHERE sku = $1", [product.sku])).map((row) => [row.store_id, row]));
  const stocked = all.flatMap((shop) => {
    const line = stock.get(shop.id);
    return line ? [{ ...shop, onHand: line.on_hand, id: shop.id, held: line.held }] : [];
  });
  return {
    sku: product.sku, lat, lon,
    shops: rankByDistance(stocked, lat, lon).map(({ shop, distanceKm }) => ({
      store_id: shop.id, name: shop.name, city: shop.city, distance_km: distanceKm, on_hand: shop.onHand, held: shop.held,
      available: shop.onHand - shop.held, display_state: displayStateOf(shop, now), holdable: !shop.suspended,
    })),
  };
}
