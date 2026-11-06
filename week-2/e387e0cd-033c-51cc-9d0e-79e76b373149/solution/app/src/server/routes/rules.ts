// The rule book, threshold changes, the daily report and the rates.
import { randomUUID } from "node:crypto";
import { allow, staff } from "../auth.js";
import { one, pool, rows } from "../db.js";
import { FieldCheck, refuse } from "../errors.js";
import { objectBody, type Router } from "../http.js";
import { amountText } from "../money.js";
import { changeBody, ruleBook } from "../rules.js";
import { effectiveStatus, type CaseRow } from "../cases/record.js";
import { listCases } from "../cases/transitions.js";
import { addDays, businessDate, formatDate, isoInstant, zonedInstant } from "../../shared/format.js";

/** The largest amount a PostgreSQL bigint cents column holds. */
const MAX_CENTS = 9223372036854775807n;

/** A real calendar date in the YYYY-MM-DD form. */
export function isBusinessDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((x) => parseInt(x, 10));
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function registerRules(router: Router): void {
  router.add("GET", "/api/w/:slug/rules", async (ctx) => {
    const who = await staff(ctx);
    return { status: 200, json: { jurisdictions: await ruleBook(pool, who.workspace, Date.now()) } };
  });

  router.add("GET", "/api/w/:slug/rules/:code", async (ctx) => {
    const who = await staff(ctx);
    const [jurisdiction] = await ruleBook(pool, who.workspace, Date.now(), ctx.params.code);
    if (!jurisdiction) throw refuse.notFound();
    return { status: 200, json: { jurisdiction } };
  });

  router.add("POST", "/api/w/:slug/rules/changes", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer");
    const body = objectBody(ctx.json());
    const now = Date.now();
    const today = businessDate(who.workspace.timeZone, now);
    const check = new FieldCheck();
    const jurisdiction = typeof body.jurisdictionCode === "string"
      ? await one<{ code: string; name: string }>(pool, "SELECT code, name FROM jurisdictions WHERE code = $1", [body.jurisdictionCode])
      : null;
    if (!jurisdiction) check.fail("jurisdictionCode", "Choose a jurisdiction.");
    const threshold = body.thresholdCents;
    if (typeof threshold !== "bigint" || threshold < 0n || threshold > MAX_CENTS) {
      check.fail("thresholdCents", "Enter a threshold of 0.00 or more with at most two decimals.");
    }
    const day = body.takesEffectOn;
    const dayOk = isBusinessDate(day) && day >= today;
    if (!dayOk) check.fail("takesEffectOn", "Choose today or a later date.");
    if (jurisdiction && dayOk && await one(pool,
      "SELECT 1 FROM threshold_changes WHERE workspace_slug = $1 AND jurisdiction_code = $2 AND takes_effect_on = $3",
      [who.workspace.slug, jurisdiction.code, day])) {
      throw refuse.conflict("change_exists", `A change for ${jurisdiction.name} on ${formatDate(day)} is already announced.`);
    }
    check.throwIfAny();
    const takesEffectAt = day === today ? now : zonedInstant(who.workspace.timeZone, day as string);
    const created = await one<Parameters<typeof changeBody>[0]>(pool,
      `INSERT INTO threshold_changes (id, workspace_slug, jurisdiction_code, threshold_cents, takes_effect_on, takes_effect_at,
         announced_by, announced_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING *`,
      [randomUUID(), who.workspace.slug, jurisdiction!.code, threshold as bigint, day, new Date(takesEffectAt),
        who.member.name, new Date(now)]);
    if (!created) {
      throw refuse.conflict("change_exists", `A change for ${jurisdiction!.name} on ${formatDate(day as string)} is already announced.`);
    }
    return { status: 201, json: { change: changeBody(created, now) } };
  });

  router.add("GET", "/api/w/:slug/reports/daily", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer", "compliance_analyst");
    const date = ctx.query.get("date");
    if (!isBusinessDate(date)) throw refuse.invalid({ date: "Choose a business date as YYYY-MM-DD." });
    const startsAt = zonedInstant(who.workspace.timeZone, date);
    const endsAt = zonedInstant(who.workspace.timeZone, addDays(date, 1));
    const found = await listCases(pool, who.workspace, "c.created_at >= $2 AND c.created_at < $3",
      [new Date(startsAt), new Date(endsAt)]);
    const now = Date.now();
    const cases = found.reverse().map((c: CaseRow) => ({
      reference: c.reference,
      createdAt: isoInstant(c.created_at.getTime()),
      asset: c.asset,
      amount: amountText(c.asset, BigInt(c.amount_atomic)),
      fiatValueCents: c.fiat_value_cents,
      currency: c.currency,
      thresholdCents: c.decided_under.thresholdCents === null ? null : BigInt(c.decided_under.thresholdCents),
      counterpartyName: c.decided_under.counterpartyName,
      path: c.path,
      status: effectiveStatus(c, now),
    }));
    return {
      status: 200,
      json: {
        date, timeZone: who.workspace.timeZone, startsAt: isoInstant(startsAt), endsAt: isoInstant(endsAt),
        hours: Math.round((endsAt - startsAt) / 3_600_000), transfers: cases.length, cases,
      },
    };
  });

  router.add("GET", "/api/w/:slug/rates", async (ctx) => {
    const who = await staff(ctx);
    const found = await rows<{ asset: string; currency: string; rate_cents: bigint; in_force_since: string }>(pool,
      "SELECT * FROM rates WHERE workspace_slug = $1 ORDER BY position", [who.workspace.slug]);
    return {
      status: 200,
      json: { rates: found.map((r) => ({ asset: r.asset, currency: r.currency, rateCents: r.rate_cents, inForceSince: r.in_force_since })) },
    };
  });
}
