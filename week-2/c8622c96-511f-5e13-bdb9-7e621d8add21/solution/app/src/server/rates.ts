// Effective-dated commission rates. A rate applies from 00:00 co-op time on its date.
import { coopDateOf, isCalendarDate } from "../shared/coop-time.js";
import { requireRole } from "./auth.js";
import { serverNow } from "./clock.js";
import { one, query, type Client } from "./db.js";
import { ApiError, sendJson } from "./http.js";
import { on, type Ctx } from "./router.js";
import { strictBody } from "./strict-body.js";

const DATE_MESSAGE = "Use YYYY-MM-DD";
const FUTURE_MESSAGE = "Effective date must be after today in co-op time";
const RATE_MESSAGE = "Rate must be 0 to 10000 basis points";

/** The rate fixed on a licence confirmed at `at`: the latest whose date's co-op midnight is at or before it. */
export async function rateAt(client: Client, at: Date): Promise<number> {
  const row = await one<{ rate_bp: number }>(
    "SELECT rate_bp FROM commission_rates WHERE effective_from <= $1::date ORDER BY effective_from DESC LIMIT 1",
    [coopDateOf(at)], client);
  return row?.rate_bp ?? 0;
}

interface RateRow {
  effective_from: string;
  rate_bp: number;
}

on("GET", "/api/commission-rates", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "treasurer");
  const today = coopDateOf(await serverNow());
  const rates = await query<RateRow>(
    "SELECT effective_from::text AS effective_from, rate_bp FROM commission_rates ORDER BY effective_from");
  const started = rates.filter((r) => r.effective_from <= today);
  const current = started[started.length - 1] ?? null;
  sendJson(ctx.res, 200, {
    current,
    rates: rates.map((r) => ({
      ...r, status: r.effective_from > today ? "scheduled" : r === current ? "current" : "past",
    })),
  });
});

on("POST", "/api/commission-rates", "json", async (ctx: Ctx) => {
  requireRole(ctx.person, "treasurer");
  const { values, errors } = strictBody(ctx.body, {
    effective_from: { kind: "string", message: DATE_MESSAGE },
    rate_bp: { kind: "integer", message: RATE_MESSAGE },
  });
  const day = typeof values.effective_from === "string" && isCalendarDate(values.effective_from)
    ? values.effective_from : null;
  if (day && await one("SELECT 1 FROM commission_rates WHERE effective_from = $1::date", [day])) {
    throw new ApiError(409, "rate_date_taken", "A rate is already scheduled from that date.");
  }
  if (typeof values.effective_from === "string") {
    if (!day) errors.add("effective_from", DATE_MESSAGE);
    else if (day <= coopDateOf(await serverNow())) errors.add("effective_from", FUTURE_MESSAGE);
  }
  if (typeof values.rate_bp === "number" && (values.rate_bp < 0 || values.rate_bp > 10000)) {
    errors.add("rate_bp", RATE_MESSAGE);
  }
  errors.fail();
  const inserted = await query<RateRow>(
    `INSERT INTO commission_rates (effective_from, rate_bp) VALUES ($1::date, $2) ON CONFLICT DO NOTHING
     RETURNING effective_from::text AS effective_from, rate_bp`, [day, values.rate_bp]);
  const rate = inserted[0];
  if (!rate) throw new ApiError(409, "rate_date_taken", "A rate is already scheduled from that date.");
  sendJson(ctx.res, 201, { effective_from: rate.effective_from, rate_bp: rate.rate_bp, status: "scheduled" });
});
