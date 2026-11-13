// Quotes: lines, the quote revision, and the title and price lock.
import { services as listServices, type Service } from "../content.js";
import { rows, transaction, type Db } from "../db.js";
import { ApiError, FIELD_COPY, invalid } from "../errors.js";
import { exponentOf, type Currency } from "../../shared/money.js";
import { priceLines, type MilestoneSplit, type PricedLine } from "./pricing.js";
import { rateInEffect } from "./rates.js";
import { assertQuoteOpen } from "./states.js";
import { loadEngagement, stageOf, type EngagementRow } from "./engagements.js";

export type Quote = {
  currency: Currency;
  exponent: number;
  revision: number;
  fx_rate: string;
  fx_locked: boolean;
  fx_locked_at: string | null;
  lines: PricedLine[];
  subtotal_minor: number;
  vat_minor: number;
  total_minor: number;
  milestones: MilestoneSplit;
};

type LineRow = { shot_code: string; quantity: number; locked_title: string | null; locked_price_pence: number | null; locked_sort: number | null };

/**
 * The title rule: until the deposit each line follows the current service record on every read; the deposit locks
 * the title and price onto the line for good. Lines come out in published shot order.
 */
function titledLines(lineRows: LineRow[], catalogue: Service[]): { shot_code: string; title: string; quantity: number; unit_price_gbp_minor: number }[] {
  const position = (line: LineRow): number => line.locked_sort ?? catalogue.findIndex((s) => s.code === line.shot_code);
  return [...lineRows]
    .sort((a, b) => position(a) - position(b))
    .map((line) => {
      const service = catalogue.find((s) => s.code === line.shot_code);
      return {
        shot_code: line.shot_code,
        title: line.locked_title ?? service?.title ?? line.shot_code,
        quantity: line.quantity,
        unit_price_gbp_minor: line.locked_price_pence ?? service?.list_price_pence ?? 0,
      };
    });
}

async function lineRows(db: Db, engagementId: string): Promise<LineRow[]> {
  return rows<LineRow>(db, "SELECT shot_code, quantity, locked_title, locked_price_pence, locked_sort FROM quote_lines WHERE engagement_id = $1", [engagementId]);
}

/** The quote as read now: the locked rate after the deposit, otherwise the rate in effect at this read. */
export async function readQuote(db: Db, engagement: EngagementRow, catalogue: Service[], now: Date): Promise<Quote> {
  const rate = engagement.locked_rate ?? (await rateInEffect(db, engagement.currency, now));
  const priced = priceLines(titledLines(await lineRows(db, engagement.id), catalogue), rate, engagement.currency);
  return {
    currency: engagement.currency,
    exponent: exponentOf(engagement.currency),
    revision: engagement.quote_revision,
    fx_rate: rate,
    fx_locked: engagement.locked_rate !== null,
    fx_locked_at: engagement.locked_at ? engagement.locked_at.toISOString() : null,
    ...priced,
  };
}

/** The service catalogue a quote read needs; a locked quote needs only the order, so a content outage is tolerated there. */
export async function catalogueFor(engagement: EngagementRow): Promise<Service[]> {
  try {
    return await listServices();
  } catch (error) {
    if (engagement.locked_rate !== null) return [];
    throw error;
  }
}

/** PUT (quantity) or DELETE (null) one quote line; every successful write raises the revision by exactly one. */
export async function writeLine(brandId: string, engagementId: string, shotCode: string, quantity: unknown, remove: boolean, now: Date): Promise<Quote> {
  const catalogue = await listServices();
  return transaction(async (client) => {
    const engagement = await loadEngagement(client, engagementId, brandId, true);
    if (!catalogue.some((service) => service.code === shotCode)) throw new ApiError("not_found");
    assertQuoteOpen(stageOf(engagement));
    if (remove) {
      await client.query("DELETE FROM quote_lines WHERE engagement_id = $1 AND shot_code = $2", [engagementId, shotCode]);
    } else {
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 6) throw invalid("quantity", FIELD_COPY.quantity);
      await client.query(
        `INSERT INTO quote_lines (engagement_id, shot_code, quantity) VALUES ($1, $2, $3)
         ON CONFLICT (engagement_id, shot_code) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [engagementId, shotCode, quantity],
      );
    }
    const revised = await client.query<{ quote_revision: number }>("UPDATE engagements SET quote_revision = quote_revision + 1 WHERE id = $1 RETURNING quote_revision", [engagementId]);
    return readQuote(client, { ...engagement, quote_revision: revised.rows[0]?.quote_revision ?? engagement.quote_revision + 1 }, catalogue, now);
  });
}

/** Locks the rate, titles and prices at the deposit moment. */
export async function lockQuote(db: Db, engagement: EngagementRow, quote: Quote, at: Date): Promise<void> {
  for (const [index, line] of quote.lines.entries()) {
    await db.query("UPDATE quote_lines SET locked_title = $3, locked_price_pence = $4, locked_sort = $5 WHERE engagement_id = $1 AND shot_code = $2", [
      engagement.id,
      line.shot_code,
      line.title,
      line.unit_price_gbp_minor,
      index,
    ]);
  }
  await db.query("UPDATE engagements SET locked_rate = $2, locked_at = $3 WHERE id = $1", [engagement.id, quote.fx_rate, at]);
}
