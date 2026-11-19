// Effective-dated policies (brief: Business rules, Policies). The rule in force on a date is decided here only.
import { first, isUniqueViolation, pool, rows, tx, type Db } from "./db.js";
import { now, today, isCompanyDate } from "./clock.js";
import { conflict, forbidden, invalid, notFound, route, sendEmpty, sendJson, bodyObject } from "./http.js";
import { newId, isId } from "./ids.js";
import { record } from "./ledger.js";
import { publish } from "./changes.js";
import { Viewer } from "./access.js";
import type { CompanyDate, Policy, PolicyKind, PolicyState } from "../shared/api.js";

interface PolicyRow {
  id: string;
  kind: PolicyKind;
  days: number;
  effective_from: CompanyDate;
}

const RANGE: Record<PolicyKind, { max: number; message: string }> = {
  bin_retention_days: { max: 90, message: "Enter whole days from 1 to 90." },
  partner_grant_days: { max: 365, message: "Enter whole days from 1 to 365." },
};

/** The row of `kind` with the latest effective date on or before `date`. */
function ruleOn(policies: PolicyRow[], kind: PolicyKind, date: CompanyDate): PolicyRow | undefined {
  return policies.filter((p) => p.kind === kind && p.effective_from <= date)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
}

export async function inForce(db: Db, kind: PolicyKind, date: CompanyDate): Promise<number> {
  const rule = ruleOn(await rows<PolicyRow>(db, "SELECT id, kind, days, effective_from FROM policies WHERE kind = $1", [kind]), kind, date);
  if (!rule) throw new Error(`no ${kind} policy in force on ${date}`);
  return rule.days;
}

function stateOf(policies: PolicyRow[], row: PolicyRow, date: CompanyDate): PolicyState {
  if (row.effective_from > date) return "scheduled";
  return ruleOn(policies, row.kind, date)?.id === row.id ? "in_force" : "past";
}

function present(policies: PolicyRow[], row: PolicyRow, date: CompanyDate): Policy {
  return { id: row.id, kind: row.kind, days: row.days, effectiveFrom: row.effective_from, state: stateOf(policies, row, date) };
}

export function register(): void {
  route("GET", "/api/policies", async ({ res, session }) => {
    if (session.person.kind !== "staff") throw forbidden();
    const day = today();
    const all = await rows<PolicyRow>(pool, "SELECT id, kind, days, effective_from FROM policies ORDER BY effective_from DESC, kind");
    sendJson(res, 200, { today: day, policies: all.map((p) => present(all, p, day)) });
  });

  route("POST", "/api/policies", async (ctx) => {
    const { res, session } = ctx;
    if (session.person.kind !== "staff" || session.person.staffRole !== "admin") throw forbidden();
    const body = bodyObject(ctx);
    const day = today();
    const kind = body.kind === "bin_retention_days" || body.kind === "partner_grant_days" ? body.kind : null;
    const fields: Record<string, string> = {};
    if (!kind) fields.kind = "Choose bin retention or partner grant length.";
    const days = typeof body.days === "number" && Number.isInteger(body.days) ? body.days : null;
    if (kind && (days === null || days < 1 || days > RANGE[kind].max)) fields.days = RANGE[kind].message;
    const from = isCompanyDate(body.effectiveFrom) ? body.effectiveFrom : null;
    if (!from || from <= day) fields.effectiveFrom = "Choose a date after today.";
    const policy = await tx(async (client) => {
      if (kind && from && await first(client, "SELECT 1 FROM policies WHERE kind = $1 AND effective_from = $2", [kind, from])) {
        throw conflict("policy_exists");
      }
      if (Object.keys(fields).length || !kind || !from || days === null) throw invalid(fields);
      const row: PolicyRow = { id: newId(), kind, days, effective_from: from };
      await client.query("INSERT INTO policies (id, kind, days, effective_from, created_at) VALUES ($1, $2, $3, $4, $5)",
        [row.id, row.kind, row.days, row.effective_from, now()]);
      await record(client, { actor: session.person, action: "policy_scheduled", detail: { kind, days: row.days, effectiveFrom: from } });
      await publish(client, { kind: "policies" });
      return present(await rows<PolicyRow>(client, "SELECT id, kind, days, effective_from FROM policies"), row, day);
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw conflict("policy_exists");
      throw error;
    });
    sendJson(res, 201, { policy });
  });

  route("DELETE", "/api/policies/:id", async ({ res, session, params }) => {
    const viewer = await Viewer.load(pool, session.person);
    if (!viewer.staff) throw notFound();
    if (!isId(params.id)) throw notFound();
    await tx(async (client) => {
      const row = await first<PolicyRow>(client, "SELECT id, kind, days, effective_from FROM policies WHERE id = $1 FOR UPDATE", [params.id]);
      if (!row) throw notFound();
      if (!viewer.isAdmin) throw forbidden();
      if (row.effective_from <= today()) throw conflict("policy_started");
      await client.query("DELETE FROM policies WHERE id = $1", [row.id]);
      await record(client, { actor: session.person, action: "policy_withdrawn", detail: { kind: row.kind, days: row.days, effectiveFrom: row.effective_from } });
      await publish(client, { kind: "policies" });
    });
    sendEmpty(res);
  });
}
