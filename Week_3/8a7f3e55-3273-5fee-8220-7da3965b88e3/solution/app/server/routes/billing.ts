import type { Contract } from "../../shared/api.js";
import { addDays, mondayOf, parseLocalDate, weekdayIndex } from "../../shared/calendar.js";
import { localDateAt } from "../agency.js";
import { closeWeek, lockOrganisationBilling, weekStatement } from "../billing.js";
import { loadContracts } from "../contracts.js";
import { one } from "../db.js";
import { apiErrors } from "../errors.js";
import { type AuthedCtx, created, ok, route } from "../http.js";
import { FIELD_MESSAGES } from "../messages.js";
import { requireRole } from "./bookings.js";

const integerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** A week start is a Monday, no later than the current agency-local week's Monday. */
function validWeekStart(ctx: AuthedCtx, weekStart: string): boolean {
  return parseLocalDate(weekStart) !== null && weekdayIndex(weekStart) === 0 && weekStart <= mondayOf(localDateAt(ctx.nowMs));
}

/** The organisation a week statement belongs to; requesters of other organisations cannot see it exist. */
async function statementOrganisation(ctx: AuthedCtx): Promise<{ id: string; name: string }> {
  const org = await one<{ id: string; name: string }>(ctx.db, "SELECT id, name FROM organisations WHERE id = $1", [ctx.params["org_id"] ?? ""]);
  if (org === null || (ctx.user.role === "requester" && ctx.user.org_id !== org.id)) throw apiErrors.notFound();
  return org;
}

export function registerBillingRoutes(): void {
  route("GET", "/api/contracts", async (ctx) => {
    requireRole(ctx, "coordinator", "billing_manager");
    return ok({ contracts: await loadContracts(ctx.db) });
  });

  route("POST", "/api/contracts/:id/rates", async (ctx) => {
    const contract = (await loadContracts(ctx.db)).find((candidate) => candidate.id === ctx.params["id"]);
    if (contract === undefined) throw apiErrors.notFound();
    requireRole(ctx, "billing_manager");
    const body = ctx.json();
    const fields: Record<string, string> = {};
    const effectiveFrom = body["effective_from"];
    if (typeof effectiveFrom !== "string" || parseLocalDate(effectiveFrom) === null || effectiveFrom <= localDateAt(ctx.nowMs)) {
      fields["effective_from"] = FIELD_MESSAGES.effectiveFromPast;
    } else if (contract.rates.some((rate) => rate.effective_from === effectiveFrom)) {
      fields["effective_from"] = FIELD_MESSAGES.effectiveFromTaken;
    }
    const hourly = body["hourly_rate_cents"];
    const surcharge = body["team_surcharge_bp"];
    const mileage = body["mileage_cents_per_mile"];
    if (!integerIn(hourly, 1, 100_000)) fields["hourly_rate_cents"] = FIELD_MESSAGES.hourly_rate_cents;
    if (!integerIn(surcharge, 0, 10_000)) fields["team_surcharge_bp"] = FIELD_MESSAGES.team_surcharge_bp;
    if (!integerIn(mileage, 0, 1_000)) fields["mileage_cents_per_mile"] = FIELD_MESSAGES.mileage_cents_per_mile;
    if (Object.keys(fields).length > 0 || typeof effectiveFrom !== "string") throw apiErrors.validation(fields);

    await lockOrganisationBilling(ctx.db, contract.org_id);
    const latest = await one<{ latest: string | null }>(ctx.db, "SELECT max(assignment_date) AS latest FROM invoice_lines WHERE org_id = $1", [contract.org_id]);
    if (latest?.latest != null && effectiveFrom <= latest.latest) {
      const tomorrow = addDays(localDateAt(ctx.nowMs), 1);
      const dayAfter = addDays(latest.latest, 1);
      throw apiErrors.rateWouldReprice(dayAfter > tomorrow ? dayAfter : tomorrow);
    }
    await ctx.db.query(
      "INSERT INTO contract_rates (contract_id, effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile) VALUES ($1, $2, $3, $4, $5)",
      [contract.id, effectiveFrom, hourly, surcharge, mileage],
    );
    const updated: Contract | undefined = (await loadContracts(ctx.db, contract.org_id))[0];
    return created(updated);
  });

  route("GET", "/api/billing/weeks/:org_id/:week_start", async (ctx) => {
    const org = await statementOrganisation(ctx);
    requireRole(ctx, "billing_manager", "requester");
    const weekStart = ctx.params["week_start"] ?? "";
    if (!validWeekStart(ctx, weekStart)) throw apiErrors.validation({ week_start: FIELD_MESSAGES.week_start });
    return ok(await weekStatement(ctx.db, org.id, org.name, weekStart));
  });

  route("POST", "/api/billing/weeks/:org_id/:week_start/close", async (ctx) => {
    const org = await statementOrganisation(ctx);
    requireRole(ctx, "billing_manager");
    const weekStart = ctx.params["week_start"] ?? "";
    if (!validWeekStart(ctx, weekStart)) throw apiErrors.validation({ week_start: FIELD_MESSAGES.week_start });
    return ok(await closeWeek(ctx.db, org.id, org.name, weekStart));
  });
}

