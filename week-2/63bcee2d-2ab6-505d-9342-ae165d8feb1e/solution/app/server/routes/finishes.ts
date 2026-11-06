import { requireRole, STUDIO_ROLES, type Member, type Role } from "../auth.js";
import { one, pool, rows, tx, type Db } from "../db.js";
import { canonicalCategory, LIMITS, parseLegacyCsv, planRow, type Finish, type RowOutcome } from "../domain/finishes.js";
import { conflict, fileTooLarge, notFound, validation } from "../http/errors.js";
import { ok, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { knownId, visibleProject, type Project } from "../scope.js";
import { csvFile, csvHeaders, figure } from "../services/csv.js";

// The finishes schedule: ordered finishes per project, the legacy CSV import and the CSV export
// (brief: Finishes, Finishes import, Finishes order).

const EDITORS: Role[] = ["director", "project_lead", "designer"];
const CSV_LIMIT = 1_000_000;

interface FinishRow {
  id: string;
  position: number;
  code: string | null;
  name: string;
  category: string;
  supplier: string;
  product_ref: string;
  location: string;
  notes: string;
}

const finishJson = (row: FinishRow) => ({
  id: row.id, position: row.position, code: row.code, name: row.name, category: row.category, supplier: row.supplier,
  productRef: row.product_ref, location: row.location, notes: row.notes,
});

const schedule = (db: Db, projectId: string) =>
  rows<FinishRow>(db, "SELECT * FROM finishes WHERE project_id = $1 ORDER BY position", [projectId]);

/** The project of a finishes endpoint: visible (else 404), then studio roles only (else 403). */
async function finishesProject(db: Db, member: Member, id: string, lock = false): Promise<Project> {
  const project = await visibleProject(db, member, id, lock);
  requireRole(member, ...STUDIO_ROLES);
  return project;
}

export const routes: Route[] = [
  {
    method: "GET", path: "/api/projects/:id/finishes", auth: "member",
    handler: async (ctx) => {
      const project = await finishesProject(pool, ctx.me, ctx.params.id);
      return ok({ finishes: (await schedule(pool, project.id)).map(finishJson) });
    },
  },
  {
    method: "POST", path: "/api/projects/:id/finishes", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const project = await finishesProject(client, member, ctx.params.id, true);
        requireRole(member, ...EDITORS);
        const body = record(ctx.json());
        const code = typeof body.code === "string" && body.code !== "" ? body.code : null;
        if (code && (await one(client, "SELECT 1 FROM finishes WHERE project_id = $1 AND code = $2", [project.id, code]))) {
          throw conflict("code_exists");
        }
        const fields = new Fields(body);
        if (code) fields.text("code", LIMITS.code.label, { min: 0, max: LIMITS.code.max });
        const name = fields.text("name", LIMITS.name.label, { max: LIMITS.name.max });
        const typed = typeof body.category === "string" ? body.category : "";
        const category = canonicalCategory(typed);
        if (!category) fields.fail("category", typed ? `Unknown category ${typed}.` : "Category is required.");
        const optional = (field: string, column: keyof typeof LIMITS) =>
          fields.text(field, LIMITS[column].label, { min: 0, max: LIMITS[column].max });
        const supplier = optional("supplier", "supplier");
        const productRef = optional("productRef", "productRef");
        const location = optional("location", "location");
        const notes = optional("notes", "notes");
        fields.done();
        const next = await one<{ n: number }>(client, "SELECT count(*)::int + 1 AS n FROM finishes WHERE project_id = $1", [project.id]);
        const finish = await one<FinishRow>(client,
          `INSERT INTO finishes (project_id, position, code, name, category, supplier, product_ref, location, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [project.id, next?.n, code, name, category, supplier, productRef, location, notes]);
        return ok({ finish: finish && finishJson(finish) }, 201);
      });
    },
  },
  {
    method: "POST", path: "/api/projects/:id/finishes/import", auth: "member", body: "csv",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const project = await finishesProject(client, member, ctx.params.id, true);
        requireRole(member, ...EDITORS);
        if (ctx.oversize) throw fileTooLarge(CSV_LIMIT);
        const text = ctx.raw.toString("utf8");
        if (!text.trim()) throw validation({ file: "Legacy CSV file is required." });
        const parsed = parseLegacyCsv(text);
        if ("error" in parsed) throw validation({ file: parsed.error });
        const current: Finish[] = (await schedule(client, project.id)).map((row) => ({
          id: row.id, code: row.code, name: row.name, category: row.category, supplier: row.supplier, productRef: row.product_ref,
          location: row.location, notes: row.notes,
        }));
        const seen = { codes: new Map<string, number>(), names: new Map<string, number>() };
        const outcomes: RowOutcome[] = [];
        for (const row of parsed.rows) {
          const outcome = planRow(row, parsed.columns, current, seen);
          outcomes.push(outcome);
          const write = outcome.write;
          if (!write) continue;
          const f = write.fields;
          if (write.id === null) {
            const created = await one<{ id: string }>(client,
              `INSERT INTO finishes (project_id, position, code, name, category, supplier, product_ref, location, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
              [project.id, current.length + 1, f.code, f.name, f.category, f.supplier, f.productRef, f.location, f.notes]);
            current.push({ id: created?.id ?? "", ...f });
          } else {
            await client.query(
              `UPDATE finishes SET code = $2, name = $3, category = $4, supplier = $5, product_ref = $6, location = $7, notes = $8
               WHERE id = $1`, [write.id, f.code, f.name, f.category, f.supplier, f.productRef, f.location, f.notes]);
            const index = current.findIndex((finish) => finish.id === write.id);
            current[index] = { id: write.id, ...f };
          }
        }
        const count = (status: RowOutcome["status"]): number => outcomes.filter((outcome) => outcome.status === status).length;
        return ok({
          summary: { created: count("created"), updated: count("updated"), unchanged: count("unchanged"), rejected: count("rejected") },
          rows: outcomes.map(({ line, status, code, name, reason }) => ({ line, status, code, name, reason })),
        });
      });
    },
  },
  {
    method: "POST", path: "/api/finishes/:id/move", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const finish = await one<{ id: string; project_id: string; position: number }>(client,
          "SELECT id, project_id, position FROM finishes WHERE id = $1", [knownId(ctx.params.id)]);
        if (!finish) throw notFound();
        const project = await finishesProject(client, member, finish.project_id, true);
        requireRole(member, ...EDITORS);
        const list = await schedule(client, project.id);
        const fields = new Fields(record(ctx.json()));
        const position = fields.integer("position", "Position", 1, list.length);
        fields.done();
        const order = list.filter((row) => row.id !== finish.id);
        order.splice(position - 1, 0, list.find((row) => row.id === finish.id) as FinishRow);
        for (const [index, row] of order.entries()) {
          if (row.position !== index + 1) await client.query("UPDATE finishes SET position = $2 WHERE id = $1", [row.id, index + 1]);
        }
        return ok({ finishes: (await schedule(client, project.id)).map(finishJson) });
      });
    },
  },
  {
    method: "GET", path: "/api/projects/:id/finishes.csv", auth: "member",
    handler: async (ctx) => {
      const project = await finishesProject(pool, ctx.me, ctx.params.id);
      const list = await schedule(pool, project.id);
      const body = "﻿" + csvFile(["position", "code", "name", "category", "supplier", "product_ref", "location", "notes"],
        list.map((row) => [figure(row.position), row.code ?? "", row.name, row.category, row.supplier, row.product_ref, row.location, row.notes]));
      return { status: 200, body, headers: csvHeaders(`${project.reference}-finishes.csv`) };
    },
  },
];

