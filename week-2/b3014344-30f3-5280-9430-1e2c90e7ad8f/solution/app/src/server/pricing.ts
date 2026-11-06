import { randomUUID } from "node:crypto";
import { one, query, type Db } from "./db";
import { errors } from "./http";
import { studioInstant } from "./time";
import { isCare, PLAN_IDS, PLAN_NAMES, type PlanId, type PriceRow, type Quote } from "../shared/domain";
import { parseAmount, sharePercent, splitBuild, toAmount, type Currency } from "../shared/money";

interface PriceInEffect {
  id: string;
  amountMinor: bigint;
  effectiveAt: Date;
}

interface PriceDbRow {
  [key: string]: unknown;
  id: string;
  plan: PlanId;
  currency: Currency;
  amount_minor: string;
  effective_at: Date;
}

/** The price in effect at an instant: the row with the latest effective instant at or before it. */
export async function priceAt(plan: PlanId, currency: Currency, at: Date, db?: Db): Promise<PriceInEffect> {
  const sql = `SELECT id, amount_minor, effective_at FROM prices
               WHERE plan = $1 AND currency = $2 AND effective_at <= $3
               ORDER BY effective_at DESC, created_at DESC LIMIT 1`;
  const row = db
    ? (await db.query<PriceDbRow>(sql, [plan, currency, at])).rows[0]
    : await one<PriceDbRow>(sql, [plan, currency, at]);
  if (!row) throw new Error(`no ${currency} price for ${plan}`);
  return { id: row.id, amountMinor: BigInt(row.amount_minor), effectiveAt: row.effective_at };
}

interface Figures {
  total: bigint;
  dueNow: bigint;
  dueAtLaunch: bigint;
}

/** A build splits into deposit and launch balance; a care plan's first month is due in full. */
export function figuresFor(plan: PlanId, total: bigint): Figures {
  if (isCare(plan)) return { total, dueNow: total, dueAtLaunch: 0n };
  return { total, ...splitBuild(total) };
}

export function quoteBody(plan: PlanId, currency: Currency, figures: Figures, effectiveAt: Date): Quote {
  return {
    plan,
    currency,
    total: toAmount(figures.total),
    dueNow: toAmount(figures.dueNow),
    dueAtLaunch: toAmount(figures.dueAtLaunch),
    dueNowShare: sharePercent(figures.dueNow, figures.total),
    priceEffectiveAt: studioInstant(effectiveAt),
  };
}

export async function planListing(currency: Currency, at: Date) {
  const plans = await Promise.all(
    PLAN_IDS.map(async (plan) => ({
      plan,
      name: PLAN_NAMES[plan],
      amount: toAmount((await priceAt(plan, currency, at)).amountMinor),
      interval: isCare(plan) ? ("month" as const) : null,
    })),
  );
  return { currency, plans };
}

export async function schedule(): Promise<PriceRow[]> {
  const rows = await query<PriceDbRow>(
    "SELECT id, plan, currency, amount_minor, effective_at FROM prices ORDER BY plan, currency, effective_at, created_at",
  );
  return rows.map((row) => ({
    id: row.id,
    plan: row.plan,
    currency: row.currency,
    amount: toAmount(BigInt(row.amount_minor)),
    effectiveAt: studioInstant(row.effective_at),
  }));
}

/** Studio owner schedules a peso price; dollar prices stay at their seed values. */
export async function schedulePrice(body: Record<string, unknown>, now: Date): Promise<PriceRow> {
  const fields: Record<string, string> = {};
  const plan = body.plan;
  if (!PLAN_IDS.includes(plan as PlanId)) fields.plan = "Choose a plan.";
  if (body.currency !== "ARS") fields.currency = "Only peso prices can be scheduled.";
  const amount = typeof body.amount === "string" ? parseAmount(body.amount) : null;
  if (amount === null || amount <= 0n) fields.amount = "Enter a positive amount with at most two decimals.";
  let effectiveAt = now;
  if (body.effectiveAt !== undefined && body.effectiveAt !== null && body.effectiveAt !== "") {
    const parsed = typeof body.effectiveAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(body.effectiveAt) ? new Date(body.effectiveAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) fields.effectiveAt = "Enter an instant such as 2026-12-01T00:00:00-03:00.";
    else if (parsed.getTime() < now.getTime() - 1000) fields.effectiveAt = "The effective instant can't be in the past.";
    else effectiveAt = parsed;
  }
  if (Object.keys(fields).length) throw errors.invalid(fields);
  const id = randomUUID();
  await query("INSERT INTO prices (id, plan, currency, amount_minor, effective_at) VALUES ($1, $2, 'ARS', $3, $4)", [
    id,
    plan,
    amount!.toString(),
    effectiveAt,
  ]);
  return { id, plan: plan as PlanId, currency: "ARS", amount: toAmount(amount!), effectiveAt: studioInstant(effectiveAt) };
}
