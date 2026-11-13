import { config } from "./config";
import { emit, one, pool, rows, unit, type Db, type Queryable, type Unit } from "./db";
import type { StockBadge } from "../shared/api";

// The stock ledger. Every change is one movement of two entries that sum to zero; every figure
// (available, reserved, committed, on hand) is a sum of entries and is never stored on its own.

export const LOCATIONS = ["bhiwandi", "gurugram"] as const;
export type Location = (typeof LOCATIONS)[number];
export type Account = "external" | "available" | "reserved" | "committed" | "dispatched";

type Reason =
  | "stock_received"
  | "stock_adjusted"
  | "hold_placed"
  | "hold_released"
  | "hold_lapsed"
  | "order_committed"
  | "order_cancelled"
  | "shipped"
  | "return_received"
  | "trial_returned"
  | "exchange_committed"
  | "replacement_committed";

/** The badge rule: one place for product cards, variants, search documents and live events. */
export function badgeFor(available: number): StockBadge {
  if (available <= 0) return "Out of stock";
  return available <= config.lowStockThreshold ? `Only ${available} left` : "In stock";
}

/** Low stock: between 0 and the threshold, both included. */
export function isLowStock(available: number): boolean {
  return available >= 0 && available <= config.lowStockThreshold;
}

interface Figures {
  available: number;
  reserved: number;
  committed: number;
  dispatched: number;
}

const ZERO: Figures = { available: 0, reserved: 0, committed: 0, dispatched: 0 };

/** Per-location figures for each sku, summed from the entries. */
export async function figures(db: Queryable, skus: string[]): Promise<Map<string, Record<Location, Figures>>> {
  const result = new Map<string, Record<Location, Figures>>();
  for (const sku of skus) result.set(sku, { bhiwandi: { ...ZERO }, gurugram: { ...ZERO } });
  if (skus.length === 0) return result;
  const found = await rows<{ sku: string; location: Location; account: Account; total: number }>(
    db,
    `SELECT sku, location, account, sum(quantity) AS total FROM stock_entries
     WHERE sku = ANY($1) AND account <> 'external' GROUP BY sku, location, account`,
    [skus],
  );
  for (const row of found) {
    const bucket = result.get(row.sku)?.[row.location];
    if (bucket) bucket[row.account as keyof Figures] = row.total;
  }
  return result;
}

export function totalAvailable(by: Record<Location, Figures>): number {
  return by.bhiwandi.available + by.gurugram.available;
}

/** Locks the variants in a fixed order so concurrent units never deadlock. */
export async function lockVariants(db: Db, skus: string[]): Promise<void> {
  if (skus.length === 0) return;
  await db.query("SELECT sku FROM variants WHERE sku = ANY($1) ORDER BY sku FOR UPDATE", [[...new Set(skus)].sort()]);
}

interface Move {
  sku: string;
  location: Location;
  reason: Reason;
  ref: string;
  from: Account;
  to: Account;
  quantity: number;
  at: Date;
}

/** One movement: minus on the source account, plus on the destination. */
export async function move(db: Db, m: Move): Promise<void> {
  const { rows: [movement] } = await db.query<{ id: string }>("INSERT INTO stock_movements (reason, ref, at) VALUES ($1, $2, $3) RETURNING id", [m.reason, m.ref, m.at]);
  await db.query(
    `INSERT INTO stock_entries (movement_id, sku, location, account, quantity) VALUES ($1, $2, $3, $4, $5), ($1, $2, $3, $6, $7)`,
    [movement?.id, m.sku, m.location, m.from, -m.quantity, m.to, m.quantity],
  );
}

/** Location with the most available, ties to bhiwandi. */
function bestLocation(by: Record<Location, Figures>): Location {
  return by.gurugram.available > by.bhiwandi.available ? "gurugram" : "bhiwandi";
}

export interface Chunk {
  location: Location;
  quantity: number;
}

/** A line is taken whole from one location: the one with the most available, ties to bhiwandi. */
export function takeFrom(by: Record<Location, Figures>, quantity: number): Chunk {
  return { location: bestLocation(by), quantity };
}

/** Units a single line can take: the available at its one location. */
export function holdable(by: Record<Location, Figures>): number {
  return by[bestLocation(by)].available;
}

export async function variantName(db: Queryable, sku: string): Promise<string> {
  const row = await one<{ label: string }>(
    db,
    `SELECT p.name || ' — ' || v.colour || ', ' || (CASE v.size_slug
        WHEN 'cabin' THEN 'Cabin' WHEN 'check-in-medium' THEN 'Check-in Medium' WHEN 'check-in-large' THEN 'Check-in Large'
        WHEN 'underseat' THEN 'Underseat' ELSE 'One size' END) AS label
     FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = $1`,
    [sku],
  );
  return row?.label ?? sku;
}


/**
 * Pushes the live stock, collection and search-index consequences of a stock or price change.
 * Called last in every unit that changes stock.
 */
export async function announceStock(u: Unit, skus: string[]): Promise<void> {
  const unique = [...new Set(skus)];
  if (unique.length === 0) return;
  const by = await figures(u.db, unique);
  for (const sku of unique) {
    const now = by.get(sku);
    if (!now) continue;
    const available = totalAvailable(now);
    emit(u, "stock", { sku, available, badge: badgeFor(available) }, "all");
  }
  await announceCollections(u, unique);
}

/** Collection numerals and the search documents of the products behind these skus. */
export async function announceCollections(u: Unit, skus: string[]): Promise<void> {
  const products = await rows<{ slug: string; category: string }>(
    u.db,
    "SELECT DISTINCT p.slug, p.category FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ANY($1)",
    [skus],
  );
  for (const p of products) await u.db.query("INSERT INTO search_dirty (slug) VALUES ($1) ON CONFLICT (slug) DO UPDATE SET marked_at = now()", [p.slug]);
  const published = products.length > 0;
  if (!published) return;
  const units = await collectionUnits(u.db);
  for (const slug of new Set(["all", ...products.map((p) => p.category)])) {
    emit(u, "collection", { slug, units: units.get(slug) ?? 0 }, "all");
  }
  u.afterCommit.push(() => kickIndexer());
}

/** Units ready to ship per collection: available across published variants. */
export async function collectionUnits(db: Queryable): Promise<Map<string, number>> {
  const found = await rows<{ category: string; units: number }>(
    db,
    `SELECT p.category, coalesce(sum(e.quantity), 0) AS units
     FROM products p JOIN variants v ON v.product_id = p.id
     LEFT JOIN stock_entries e ON e.sku = v.sku AND e.account = 'available'
     WHERE p.status = 'published' GROUP BY p.category`,
  );
  const map = new Map<string, number>();
  let all = 0;
  for (const row of found) {
    map.set(row.category, row.units);
    all += row.units;
  }
  map.set("all", all);
  return map;
}

let kicker: (() => void) | null = null;
export function onKickIndexer(fn: () => void): void {
  kicker = fn;
}
function kickIndexer(): void {
  kicker?.();
}

/** Releases every hold whose time has passed (hold_lapsed). Releasing twice is harmless. */
export async function lapseExpiredHolds(): Promise<void> {
  const cutoff = new Date(Date.now() - config.reservationTtlSeconds * 1000);
  const due = await one<{ n: number }>(
    pool,
    `SELECT count(*) AS n FROM checkouts c
     WHERE c.reserved_at IS NOT NULL AND c.reserved_at <= $1 AND EXISTS (SELECT 1 FROM hold_chunks h WHERE h.checkout_id = c.id AND h.state = 'active')`,
    [cutoff],
  );
  if (!due || due.n === 0) return;
  await unit(async (u) => {
    const checkouts = await rows<{ id: string }>(
      u.db,
      `SELECT c.id FROM checkouts c
       WHERE c.reserved_at IS NOT NULL AND c.reserved_at <= $1 AND EXISTS (SELECT 1 FROM hold_chunks h WHERE h.checkout_id = c.id AND h.state = 'active')
       ORDER BY c.id FOR UPDATE SKIP LOCKED`,
      [cutoff],
    );
    const touched: string[] = [];
    for (const { id } of checkouts) touched.push(...(await releaseHold(u, id, "hold_lapsed", "lapsed", new Date())));
    await announceStock(u, touched);
  });
}

/** Moves a checkout's active hold chunks back to available. Returns the skus touched. */
async function releaseHold(u: Unit, checkoutId: string, reason: "hold_lapsed" | "hold_released", state: "lapsed", at: Date): Promise<string[]> {
  const chunks = await rows<{ id: number; sku: string; location: Location; quantity: number }>(
    u.db,
    "SELECT id, sku, location, quantity FROM hold_chunks WHERE checkout_id = $1 AND state = 'active' ORDER BY id FOR UPDATE",
    [checkoutId],
  );
  await lockVariants(u.db, chunks.map((c) => c.sku));
  for (const chunk of chunks) {
    await move(u.db, { sku: chunk.sku, location: chunk.location, reason, ref: `checkout:${checkoutId}`, from: "reserved", to: "available", quantity: chunk.quantity, at });
    await u.db.query("UPDATE hold_chunks SET state = $2 WHERE id = $1", [chunk.id, state]);
  }
  return chunks.map((c) => c.sku);
}
