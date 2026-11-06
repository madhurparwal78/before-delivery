// Price-list selection, line pricing with Danish VAT, and the largest-remainder split (brief: Business rules →
// Pricing, Allocations and split). Money is integer minor units throughout.
import { type Market, copenhagenToday, isoDate } from "../shared/time";
import { type Db, rows } from "./db";

interface PriceInForce {
  priceListId: string;
  styleNumber: string;
  currency: string;
  unitPriceMinor: number;
  effectiveDate: string;
}

/**
 * The price in force on `day` for every style and currency of a workspace: the latest-effective list dated on or
 * before that day that prices it, with equal dates going to the later-created list.
 */
export async function pricesInForceOn(db: Db, workspaceId: string, day: string): Promise<PriceInForce[]> {
  return rows<PriceInForce>(
    db,
    `SELECT DISTINCT ON (lower(p.style_number), p.currency) l.id AS "priceListId", p.style_number AS "styleNumber", p.currency,
       p.unit_price_minor AS "unitPriceMinor", l.effective_date AS "effectiveDate"
     FROM price_list_prices p JOIN price_lists l ON l.id = p.price_list_id
     WHERE l.workspace_id = $1 AND l.effective_date <= $2::date
     ORDER BY lower(p.style_number), p.currency, l.effective_date DESC, l.created_order DESC`,
    [workspaceId, day],
  );
}

/** The prices in force on `day` in one currency, keyed by lower-case style number. */
export async function pricesInForce(db: Db, workspaceId: string, currency: string, day: string): Promise<Map<string, PriceInForce>> {
  const all = await pricesInForceOn(db, workspaceId, day);
  return new Map(all.filter((p) => p.currency === currency).map((p) => [p.styleNumber.toLowerCase(), p]));
}

export function copenhagenDay(nowMs = Date.now()): string {
  return isoDate(copenhagenToday(nowMs));
}

interface PricedLine {
  netMinor: number;
  vatMinor: number;
  lineTotalMinor: number;
}

/** net = unit × quantity; Copenhagen-market stockists pay 25% VAT on each line, rounded half up on its own. */
export function priceLine(unitPriceMinor: number, quantity: number, market: Market): PricedLine {
  const netMinor = unitPriceMinor * quantity;
  const vatMinor = market === "copenhagen" ? Math.floor((netMinor * 25 + 50) / 100) : 0;
  return { netMinor, vatMinor, lineTotalMinor: netMinor + vatMinor };
}

interface Request {
  stockistId: string;
  requested: number;
}

/**
 * Shares of one style's wholesale edition. Requests that fit are granted in full; otherwise each gets
 * floor(edition × requested ÷ total) and the leftover pieces go one each to the largest fractional remainders,
 * ties to the earliest request (the input order).
 */
export function splitEdition(edition: number, requests: Request[]): Map<string, number> {
  const total = requests.reduce((sum, r) => sum + r.requested, 0);
  if (total <= edition) return new Map(requests.map((r) => [r.stockistId, r.requested]));
  const shares = requests.map((r, index) => ({
    id: r.stockistId,
    index,
    share: Math.floor((edition * r.requested) / total),
    remainder: (edition * r.requested) % total,
  }));
  let left = edition - shares.reduce((sum, s) => sum + s.share, 0);
  for (const s of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (left <= 0) break;
    s.share += 1;
    left -= 1;
  }
  return new Map(shares.map((s) => [s.id, s.share]));
}
