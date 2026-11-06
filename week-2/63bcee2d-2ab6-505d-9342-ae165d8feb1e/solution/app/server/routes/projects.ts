import { isStudio, requireRole, STUDIO_ROLES } from "../auth.js";
import { one, pool, rows, tx } from "../db.js";
import { currentStage, stageName, STAGES } from "../domain/stages.js";
import { conflict } from "../http/errors.js";
import { ok, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { loadProject, projectJson, visibleProject, canSeeProject } from "../scope.js";

const MAX_CENTS = 99_999_999_999;
const CURRENCY_COPY = "Hong Kong and Macao projects bill in HKD; Singapore projects bill in SGD.";
const STORE_CODE = /^[A-Z0-9-]{1,16}$/;

export const routes: Route[] = [
  {
    method: "GET", path: "/api/brands", auth: "member",
    handler: async (ctx) => {
      requireRole(ctx.me, ...STUDIO_ROLES);
      return ok({ brands: await rows(pool, "SELECT id, name FROM brands ORDER BY name") });
    },
  },
  {
    method: "GET", path: "/api/companies", auth: "member",
    handler: async (ctx) => {
      requireRole(ctx.me, ...STUDIO_ROLES);
      return ok({ companies: await rows(pool, "SELECT id, name FROM companies ORDER BY name") });
    },
  },
  {
    method: "GET", path: "/api/overview", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      const ids = await rows<{ id: string }>(pool, "SELECT id FROM projects ORDER BY number");
      const projects = [];
      for (const { id } of ids) {
        const project = await loadProject(pool, id);
        if (!project || !canSeeProject(member, project)) continue;
        const stages = await rows<{ key: string; state: string; fee_cents: number | null }>(pool,
          "SELECT key, state, fee_cents FROM stages WHERE project_id = $1 ORDER BY position", [id]);
        const entry: Record<string, unknown> = {
          id, reference: project.reference, name: project.name, brand: { id: project.brandId, name: project.brandName },
          region: project.region, currentStage: currentStage(stages), currentStageName: stageName(currentStage(stages)),
        };
        if (isStudio(member)) {
          const sum = (state: string[]): number => stages.filter((s) => s.fee_cents !== null && state.includes(s.state))
            .reduce((total, s) => total + Number(s.fee_cents), 0);
          const held = await one<{ held: number }>(pool,
            `SELECT coalesce(sum(CASE WHEN side = 'credit' THEN amount_cents ELSE -amount_cents END), 0)::bigint AS held
             FROM retention_entries WHERE project_id = $1 AND account = 'retention_held'`, [id]);
          Object.assign(entry, {
            currency: project.currency,
            fees: { signedOffCents: sum(["signed_off"]), requestedCents: sum(["requested"]), notYetRequestedCents: sum(["not_started", "returned"]) },
            retentionHeldCents: Number(held?.held ?? 0),
          });
        }
        projects.push(entry);
      }
      return ok({ projects });
    },
  },
  {
    method: "POST", path: "/api/projects", auth: "member",
    handler: async (ctx) => {
      requireRole(ctx.me, "director", "project_lead");
      const body = record(ctx.json());
      const fields = new Fields(body);
      const name = fields.text("name", "Name", { max: 120, oneLine: true });
      const brandId = typeof body.brandId === "string" ? body.brandId : "";
      const brand = /^[0-9a-f-]{36}$/i.test(brandId) ? await one(pool, "SELECT id FROM brands WHERE id = $1", [brandId]) : undefined;
      if (!brand) fields.fail("brandId", "Brand is required.");
      const region = fields.oneOf("region", "Region", ["HK", "SG", "MO"] as const);
      const expected = region === "SG" ? "SGD" : "HKD";
      if (!fields.has("region") && body.currency !== expected) fields.fail("currency", CURRENCY_COPY);
      const feeSource = record(body.stageFees);
      const fees = STAGES.filter((stage) => stage.feeKey).map((stage) =>
        fields.cents(`stageFees.${stage.feeKey}`, `${stage.name} fee`, { min: 1, max: MAX_CENTS }, feeSource[stage.feeKey ?? ""]));
      const storeList = Array.isArray(body.stores) ? body.stores.map(record) : [];
      if (storeList.length < 1 || storeList.length > 60) fields.fail("stores", "A project has 1 to 60 stores.");
      const seen = new Set<string>();
      const stores = storeList.map((store, index) => {
        const code = typeof store.code === "string" ? store.code : "";
        if (!STORE_CODE.test(code)) fields.fail(`stores[${index}].code`, "Store code is up to 16 capital letters, digits and hyphens.");
        else if (seen.has(code)) fields.fail(`stores[${index}].code`, "Store codes must be unique within the project.");
        seen.add(code);
        return {
          code,
          name: fields.text(`stores[${index}].name`, "Store name", { max: 120, oneLine: true }, store.name),
          weight: fields.integer(`stores[${index}].weight`, "Weight", 1, 1_000_000, store.weight),
        };
      });
      const defects = body.defectsPeriodMonths === undefined ? 12 : fields.integer("defectsPeriodMonths", "Defects period", 1, 24);
      fields.done();
      const project = await tx(async (client) => {
        await client.query("LOCK TABLE projects IN SHARE ROW EXCLUSIVE MODE");
        const next = await one<{ n: number }>(client, "SELECT coalesce(max(number), 2600) + 1 AS n FROM projects");
        const number = Number(next?.n);
        const created = await one<{ id: string }>(client,
          `INSERT INTO projects (number, reference, name, brand_id, region, currency, time_zone, defects_period_months)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [number, `MH-${String(number).padStart(4, "0")}`, name, brandId, region, expected,
            region === "SG" ? "Asia/Singapore" : "Asia/Hong_Kong", defects]);
        const id = created?.id ?? "";
        for (const [index, store] of stores.entries()) {
          await client.query("INSERT INTO stores (project_id, code, name, weight, position) VALUES ($1, $2, $3, $4, $5)",
            [id, store.code, store.name, store.weight, index + 1]);
        }
        let feeIndex = 0;
        for (const [index, stage] of STAGES.entries()) {
          await client.query("INSERT INTO stages (project_id, key, position, fee_cents, state) VALUES ($1, $2, $3, $4, 'not_started')",
            [id, stage.key, index + 1, stage.feeKey ? fees[feeIndex++] : null]);
        }
        return loadProject(client, id);
      });
      return ok({ project: project && projectJson(project) }, 201);
    },
  },
  {
    method: "GET", path: "/api/projects/:id", auth: "member",
    handler: async (ctx) => ok({ project: projectJson(await visibleProject(pool, ctx.me, ctx.params.id)) }),
  },
  {
    method: "POST", path: "/api/projects/:id/contract", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const project = await visibleProject(client, member, ctx.params.id, true);
        requireRole(member, "director", "project_lead");
        if (project.contract) throw conflict("contract_exists");
        const body = record(ctx.json());
        const fields = new Fields(body);
        const companyId = typeof body.companyId === "string" ? body.companyId : "";
        const company = /^[0-9a-f-]{36}$/i.test(companyId) ? await one(client, "SELECT id FROM companies WHERE id = $1", [companyId]) : undefined;
        if (!company) fields.fail("companyId", "Company name is required.");
        const sum = fields.cents("contractSumCents", "Contract sum", { min: 1, max: MAX_CENTS });
        fields.done();
        await client.query("INSERT INTO contracts (project_id, company_id, contract_sum_cents) VALUES ($1, $2, $3)", [project.id, companyId, sum]);
        const saved = await visibleProject(client, member, project.id);
        return ok({ contract: saved.contract && { companyName: saved.contract.companyName, contractSumCents: saved.contract.contractSumCents } }, 201);
      });
    },
  },
];
