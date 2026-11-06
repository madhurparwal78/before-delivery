// The catalogue, resolved model access, and rate schedules.

import { allow, authenticate, type Caller } from "../auth";
import { one, pool, rows, single } from "../db";
import { resolveAccess } from "../domain/access";
import { currentPolicy, type Policy } from "../domain/policy";
import { rateAt, rateStatus, type RateRow } from "../domain/rates";
import { fail, invalid } from "../errors";
import { json, noContent, route } from "../http";
import type { InputSchema } from "../../shared/schema";
import { instantOf, localIso, parseLocal } from "../../shared/tz";
import { UNIT_LABELS, type Unit } from "../../shared/units";

interface ModelRow {
  slug: string;
  name: string;
  modality: string;
  unit: Unit;
  input_schema: InputSchema;
}

async function modelView(model: ModelRow, caller: Caller, policy: Policy, now: Date): Promise<Record<string, unknown>> {
  const rate = await rateAt(pool, model.slug, now);
  return {
    slug: model.slug,
    name: model.name,
    modality: model.modality,
    unit: model.unit,
    unit_label: UNIT_LABELS[model.unit],
    input_schema: model.input_schema,
    current_rate: { id: rate.id, micro_per_unit: rate.micro_per_unit, effective_at: rate.effective_at.toISOString() },
    access: caller.team_id === null ? null : {
      api: resolveAccess(policy, caller.team_id, model.slug, "api"),
      playground: resolveAccess(policy, caller.team_id, model.slug, "playground"),
    },
  };
}

async function findModel(slug: string): Promise<ModelRow> {
  const model = await one<ModelRow>(pool, "SELECT slug, name, modality, unit, input_schema FROM models WHERE slug = $1", [slug]);
  if (!model) fail("not_found");
  return model;
}

route("GET", "/api/models", "none", async (req) => {
  const caller = await authenticate(req);
  const policy = await currentPolicy(pool);
  const now = new Date();
  const models = await rows<ModelRow>(pool, "SELECT slug, name, modality, unit, input_schema FROM models ORDER BY position");
  return json(200, { models: await Promise.all(models.map((m) => modelView(m, caller, policy, now))) });
});

route("GET", "/api/models/{slug}", "none", async (req) => {
  const caller = await authenticate(req);
  const model = await findModel(req.params.slug);
  return json(200, { model: await modelView(model, caller, await currentPolicy(pool), new Date()) });
});

interface ScheduledRate extends RateRow {
  creator_name: string | null;
}

const RATE_SELECT = `
  SELECT r.id, r.model, r.micro_per_unit, r.effective_at, r.created_by, m.name AS creator_name FROM rates r
  LEFT JOIN members m ON m.id = r.created_by`;

function projectRate(r: ScheduledRate, current: RateRow, now: Date, zone: string): Record<string, unknown> {
  return {
    id: r.id,
    micro_per_unit: r.micro_per_unit,
    effective_at: r.effective_at.toISOString(),
    effective_at_local: localIso(r.effective_at.getTime(), zone),
    status: rateStatus(r, current, now),
    created_by: r.created_by ? { id: r.created_by, name: r.creator_name } : null,
  };
}

route("GET", "/api/models/{slug}/rates", "none", async (req) => {
  await authenticate(req);
  const model = await findModel(req.params.slug);
  const now = new Date();
  const { timezone } = await currentPolicy(pool);
  const current = await rateAt(pool, model.slug, now);
  const rates = await rows<ScheduledRate>(pool, `${RATE_SELECT} WHERE r.model = $1 ORDER BY r.effective_at, r.created_at`, [model.slug]);
  return json(200, { rates: rates.map((r) => projectRate(r, current, now, timezone)) });
});
const MAX_MICRO_PER_UNIT = 1_000_000_000_000;

route("POST", "/api/models/{slug}/rates", "json", async (req) => {
  const caller = await authenticate(req);
  const model = await findModel(req.params.slug);
  allow(caller, "finance");
  const body = (req.json ?? {}) as { micro_per_unit?: unknown; effective_at_local?: unknown };
  const { timezone } = await currentPolicy(pool);
  const errors: Record<string, string> = {};
  const micro = body.micro_per_unit;
  if (typeof micro !== "number" || !Number.isInteger(micro) || micro < 1 || micro > MAX_MICRO_PER_UNIT) {
    errors.micro_per_unit = "Enter a whole number of micro-credits from 1 to 1000000000000.";
  }
  const text = typeof body.effective_at_local === "string" ? body.effective_at_local : "";
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text) ? parseLocal(text) : null;
  const instant = local ? instantOf(local, timezone) : null;
  if (!local) errors.effective_at_local = "Use the format YYYY-MM-DDTHH:MM:SS.";
  else if (instant === null) errors.effective_at_local = `That time does not exist in ${timezone} because clocks move forward.`;
  else if (instant <= Date.now()) errors.effective_at_local = "Choose a moment in the future.";
  if (Object.keys(errors).length) invalid(errors);
  const { id } = await single<{ id: string }>(pool,
    `INSERT INTO rates (id, model, micro_per_unit, effective_at, created_by, created_at)
     SELECT 'r_' || nextval('rate_number'), $1, $2, $3, $4, now() RETURNING id`,
    [model.slug, BigInt(micro as number), new Date(instant as number), caller.id]);
  const now = new Date();
  const rate = await single<ScheduledRate>(pool, `${RATE_SELECT} WHERE r.id = $1`, [id]);
  return json(201, { rate: projectRate(rate, await rateAt(pool, model.slug, now), now, timezone) });
});

route("DELETE", "/api/models/{slug}/rates/{id}", "none", async (req) => {
  const caller = await authenticate(req);
  const model = await findModel(req.params.slug);
  const rate = await one<RateRow>(pool,
    "SELECT id, model, micro_per_unit, effective_at, created_by FROM rates WHERE id = $1 AND model = $2", [req.params.id, model.slug]);
  if (!rate) fail("not_found");
  allow(caller, "finance");
  const withdrawn = await pool.query("DELETE FROM rates WHERE id = $1 AND effective_at > now()", [rate.id]);
  if (withdrawn.rowCount === 0) fail("rate_already_effective");
  return noContent;
});
