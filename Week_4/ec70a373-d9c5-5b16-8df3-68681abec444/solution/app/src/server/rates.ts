// Effective-dated rates per site: scheduling, the schedule view and rate resolution.
import { randomUUID } from "node:crypto";
import { pool, rows, tx, isUniqueViolation, type Db } from "./db.ts";
import { ApiError } from "./http.ts";
import { now } from "./clock.ts";
import { json, type AuthedCtx, type Reply } from "./router.ts";
import { Fields } from "./validate.ts";
import { siteFor } from "./scope.ts";
import { projectRates, resolveRate, type RateRow } from "./projections.ts";
import { wallClock, type IsoDate } from "../shared/time.ts";
import { thousandths } from "./pricing.ts";

const RATE_SELECT = "SELECT id, effective_from, hourly_rate_cents, tax_rate_percent, created_at FROM rates";

async function schedule(db: Db | typeof pool, siteId: string): Promise<RateRow[]> {
  return rows<RateRow>(db, `${RATE_SELECT} WHERE site_id = $1 ORDER BY effective_from`, [siteId]);
}

/** The rate for a booking's site-local start date, from the schedule as it stands now. */
export async function rateFor(db: Db, siteId: string, startDate: IsoDate): Promise<RateRow | undefined> {
  return resolveRate(await schedule(db, siteId), startDate);
}

// GET /api/sites/{site_id}/rates
export async function listRates(ctx: AuthedCtx): Promise<Reply> {
  const site = await siteFor(pool, ctx.user, ctx.params.site_id);
  return json(200, { rates: projectRates(await schedule(pool, site.id), wallClock(now(), site.time_zone).date) });
}

const MAX_TAX_THOUSANDTHS = 25_000n;
const TAX_RE = /^\d{1,2}(\.\d{1,3})?$/;

function validTax(value: unknown): string | null {
  if (typeof value !== "string" || !TAX_RE.test(value)) return null;
  return thousandths(value) <= MAX_TAX_THOUSANDTHS ? value : null;
}

// POST /api/sites/{site_id}/rates
export async function scheduleRate(ctx: AuthedCtx): Promise<Reply> {
  const site = await siteFor(pool, ctx.user, ctx.params.site_id);
  const fields = new Fields(ctx.body, ["effective_from", "hourly_rate_cents", "tax_rate_percent"]);
  const today = wallClock(now(), site.time_zone).date;
  const effectiveFrom = fields.date("effective_from", "The effective date must be after today in site time.");
  if (effectiveFrom !== undefined && effectiveFrom <= today) fields.fail("effective_from", "The effective date must be after today in site time.");
  const hourly = fields.integer("hourly_rate_cents", 1, 100_000, "Enter an hourly rate between $0.01 and $1,000.00.");
  const tax = validTax(fields.raw("tax_rate_percent")) ?? fields.fail("tax_rate_percent", "Enter a tax rate between 0 and 25 percent with up to three decimals.");
  if (effectiveFrom === undefined || hourly === undefined || tax === undefined) return fields.reject();
  fields.raise();
  return tx(async (db) => {
    const id = randomUUID();
    try {
      await db.query(
        "INSERT INTO rates (id, site_id, effective_from, hourly_rate_cents, tax_rate_percent, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, site.id, effectiveFrom, hourly, tax, new Date(now())],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError("rate_exists");
      throw error;
    }
    const list = projectRates(await schedule(db, site.id), today);
    const rate = list.find((r) => r.id === id);
    return json(201, { rate, rates: list });
  });
}
