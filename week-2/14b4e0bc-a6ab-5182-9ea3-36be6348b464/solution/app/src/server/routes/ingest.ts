import { randomUUID } from "node:crypto";
import { loadSamples, loadSnapshot } from "../catalog.ts";
import { pool } from "../db.ts";
import { conflict, FieldErrors, inPrecedence, notFound } from "../errors.ts";
import { graphWrite } from "../graph.ts";
import type { Route } from "../http.ts";
import { may } from "../permissions.ts";
import { TRANSFORMS } from "../tags.ts";
import { codePoints, withinLength } from "../text.ts";
import { assetDetail } from "../views.ts";
import { commitWrite } from "../write.ts";

const ASSET_ID = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** Column names: letters of any script, combining marks, decimal digits and _, starting with a letter, no upper or title case (DP-77). */
function validColumnName(name: unknown): name is string {
  return withinLength(name, 1, 60) && /^\p{L}[\p{L}\p{M}\p{Nd}_]*$/u.test(name) && !/[\p{Lu}\p{Lt}]/u.test(name);
}

function validColumn(column: unknown): column is { name: string; data_type: string; samples: string[] } {
  if (column === null || typeof column !== "object") return false;
  const c = column as Record<string, unknown>;
  return validColumnName(c.name) && withinLength(c.data_type, 1, 40) && Array.isArray(c.samples) && c.samples.length <= 5 &&
    c.samples.every((s) => withinLength(s, 0, 200));
}

export const ingestRoutes: Route[] = [
  {
    method: "POST",
    pattern: "/api/assets",
    async handler(ctx) {
      const body = ctx.json();
      const detail = await commitWrite(ctx.actor, may.curate, async ({ tx, seq, actor }) => {
        const id = typeof body.id === "string" ? body.id : "";
        const ownerId = typeof body.owner_id === "string" ? body.owner_id : "";
        const columns = Array.isArray(body.columns) ? body.columns : [];
        await inPrecedence({
          async state() {
            if (id && (await tx.query("select 1 from assets where id = $1", [id])).rowCount) {
              throw conflict("asset_exists", `${id} is already registered.`);
            }
          },
          async validation() {
            const errors = new FieldErrors();
            if (!ASSET_ID.test(id) || codePoints(id) > 120) errors.add("id", "Use schema.table in lowercase letters, digits and underscores.");
            if (!["table", "view", "dashboard"].includes(body.kind as string)) errors.add("kind", "Kind must be table, view or dashboard.");
            if (!withinLength(body.description, 1, 500)) errors.add("description", "Use 1 to 500 characters.");
            if (!(await tx.query("select 1 from users where id = $1", [ownerId])).rowCount) errors.add("owner_id", "Unknown user.");
            const names = columns.map((c) => (c && typeof c === "object" ? (c as { name?: unknown }).name : undefined));
            if (!Array.isArray(body.columns) || columns.length < 1 || columns.length > 200 || new Set(names).size !== names.length) {
              errors.add("columns", "Give 1 to 200 columns with unique names.");
            }
            columns.forEach((c, i) => validColumn(c) || errors.add(`columns[${i}]`, "Check this column's name, type and samples."));
            errors.throwIfAny();
          },
        });
        const valid = columns as { name: string; data_type: string; samples: string[] }[];
        await tx.query("insert into assets(id, kind, description, owner_id, registered_seq) values ($1, $2, $3, $4, $5)", [
          id, body.kind, body.description, ownerId, seq,
        ]);
        await tx.query(
          `insert into columns(id, asset_id, name, data_type, samples, ord)
           select $1 || '.' || n, $1, n, t, s::jsonb, o - 1 from unnest($2::text[], $3::text[], $4::text[]) with ordinality as x(n, t, s, o)`,
          [id, valid.map((c) => c.name), valid.map((c) => c.data_type), valid.map((c) => JSON.stringify(c.samples))],
        );
        await tx.query("insert into certifications(asset_id, state, from_seq) values ($1, 'draft', $2)", [id, seq]);
        const snapshot = await loadSnapshot(tx, null);
        const samples = await loadSamples(tx, snapshot.assetColumns.get(id) ?? []);
        return {
          audit: {
            action: "asset.register", targetType: "asset", targetId: id, before: null,
            after: { kind: body.kind as string, owner_id: ownerId, columns: valid.map((c) => c.name) },
          },
          result: assetDetail(snapshot, id, samples, actor.role),
        };
      });
      return { status: 201, body: detail };
    },
  },
  {
    method: "POST",
    pattern: "/api/lineage/edges",
    async handler(ctx) {
      const body = ctx.json();
      const result = await commitWrite(ctx.actor, may.curate, async ({ tx, seq }) => {
        const entries = Array.isArray(body.edges) ? (body.edges as unknown[]) : [];
        const shaped = entries.map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : {}));
        const pairs = shaped.map((e) => `${String(e.from)}\u0000${String(e.to)}`);
        const live = await tx.query(
          `select from_col, to_col from edges e join unnest($1::text[], $2::text[]) as x(f, t) on e.from_col = x.f and e.to_col = x.t
           where e.to_seq is null`,
          [shaped.map((e) => String(e.from)), shaped.map((e) => String(e.to))],
        );
        const existing = new Set(live.rows.map((r: { from_col: string; to_col: string }) => `${r.from_col}\u0000${r.to_col}`));
        await inPrecedence({
          state() {
            const conflictAt = pairs.findIndex((p, i) => existing.has(p) || pairs.indexOf(p) < i);
            if (conflictAt >= 0) {
              throw conflict("edge_exists", `An edge from ${String(shaped[conflictAt].from)} to ${String(shaped[conflictAt].to)} already exists.`);
            }
          },
          async validation() {
            const errors = new FieldErrors();
            if (!Array.isArray(body.edges) || entries.length < 1 || entries.length > 1000) errors.add("edges", "Send 1 to 1,000 edges.");
            const ends = [...new Set(shaped.flatMap((e) => [e.from, e.to]).filter((x): x is string => typeof x === "string"))];
            const known = new Set((await tx.query("select id from columns where id = any($1)", [ends])).rows.map((r: { id: string }) => r.id));
            shaped.forEach((e, i) => {
              if (typeof e.from !== "string" || !known.has(e.from)) errors.add(`edges[${i}].from`, "Unknown column.");
              if (typeof e.to !== "string" || !known.has(e.to)) errors.add(`edges[${i}].to`, "Unknown column.");
              else if (e.from === e.to) errors.add(`edges[${i}].to`, "An edge cannot point to its own column.");
              if (!(TRANSFORMS as readonly string[]).includes(e.transform as string)) {
                errors.add(`edges[${i}].transform`, "Transform must be one of copy, rename, cast, filter, join, concat, hash, aggregate.");
              }
            });
            errors.throwIfAny();
          },
        });
        const created = shaped.map((e) => ({ id: randomUUID(), from: e.from as string, to: e.to as string, transform: e.transform as string }));
        const change = await graphWrite(tx, async () => {
          await tx.query(
            `insert into edges(id, from_col, to_col, transform, from_seq)
             select i, f, t, tr, $5 from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as x(i, f, t, tr)`,
            [created.map((e) => e.id), created.map((e) => e.from), created.map((e) => e.to), created.map((e) => e.transform), seq],
          );
        });
        return {
          audit: { action: "lineage.add", targetType: "lineage", targetId: created[0].id, before: null, after: { edges: created } },
          result: { edges: created, changed_columns: change.changed },
        };
      });
      return { status: 201, body: result };
    },
  },
  {
    method: "DELETE",
    pattern: "/api/lineage/edges/:id",
    async handler(ctx) {
      const id = ctx.params.id;
      await inPrecedence({
        async existence() {
          if (!(await pool.query("select 1 from edges where id = $1 and to_seq is null", [id])).rowCount) throw notFound();
        },
      });
      const result = await commitWrite(ctx.actor, may.curate, async ({ tx, seq }) => {
        const edge = (await tx.query(
          `select id, from_col as "from", to_col as "to", transform from edges where id = $1 and to_seq is null`, [id],
        )).rows[0];
        await inPrecedence({
          existence() {
            if (!edge) throw notFound();
          },
        });
        const change = await graphWrite(tx, () => tx.query("update edges set to_seq = $2 where id = $1", [id, seq]));
        return {
          audit: { action: "lineage.remove", targetType: "lineage", targetId: id, before: { edge }, after: null },
          result: { changed_columns: change.changed },
        };
      });
      return { status: 200, body: result };
    },
  },
];
