import { randomUUID } from "node:crypto";
import { errors } from "../errors.js";
import { route, type Route, type RequestContext } from "../router.js";
import { audit } from "../audit.js";

function validateWeight(raw: unknown, fields: Record<string, string>): number | null {
  if (raw === undefined) return null;
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > 100) {
    fields.weight = "Weight must be a whole number from 0 to 100.";
    return null;
  }
  return raw as number;
}

export const objectiveRoutes: Route[] = [
  {
    pattern: route("objectives"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const result = await ctx.pool.query<{ id: string; name: string; weight: number }>(
        "SELECT id, name, weight FROM objectives WHERE workspace_id = $1 ORDER BY position, id",
        [ctx.member!.workspaceId],
      );
      return { status: 200, body: { objectives: result.rows } };
    },
  },
  {
    pattern: route("objectives"),
    methods: ["POST"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const name = typeof ctx.body.name === "string" ? ctx.body.name.trim() : "";
      const fields: Record<string, string> = {};
      if (name.length < 1 || name.length > 120) fields.name = "Add an objective name.";
      const weight = validateWeight(ctx.body.weight, fields);
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
      const id = randomUUID();
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const pos = await client.query<{ next: number }>(
          "SELECT coalesce(max(position) + 1, 0) AS next FROM objectives WHERE workspace_id = $1",
          [workspaceId],
        );
        await client.query(
          "INSERT INTO objectives (id, workspace_id, name, weight, position) VALUES ($1, $2, $3, $4, $5)",
          [id, workspaceId, name, weight ?? 0, pos.rows[0]?.next ?? 0],
        );
        // A new objective starts at fit 0 on every feature.
        const features = await client.query<{ id: string }>(
          "SELECT id FROM features WHERE workspace_id = $1",
          [workspaceId],
        );
        for (const f of features.rows) {
          await client.query(
            "UPDATE features SET fits = fits || $1::jsonb WHERE id = $2",
            [JSON.stringify({ [id]: 0 }), f.id],
          );
        }
        await audit(client, workspaceId, ctx.member!.id, "create_objective", "objective", id, { name });
        await client.query("COMMIT");
        const row = await client.query<{ id: string; name: string; weight: number }>(
          "SELECT id, name, weight FROM objectives WHERE id = $1",
          [id],
        );
        return { status: 201, body: { objective: row.rows[0] } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("objectives/:id"),
    methods: ["PATCH"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const name = ctx.body.name;
      const fields: Record<string, string> = {};
      const weight = validateWeight(ctx.body.weight, fields);
      if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length < 1 || name.length > 120) {
          fields.name = "Add an objective name.";
        }
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const row = await client.query("SELECT id FROM objectives WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [
          id,
          workspaceId,
        ]);
        if (row.rowCount === 0) throw errors.notFound();
        // A weight change updates every feature's fit and priority on the
        // next read, without changing any version (DP-17).
        await client.query(
          "UPDATE objectives SET name = COALESCE($1, name), weight = COALESCE($2, weight) WHERE id = $3",
          [
            name === undefined ? null : (name as string).trim(),
            weight === null ? null : weight,
            id,
          ],
        );
        await audit(client, workspaceId, ctx.member!.id, "edit_objective", "objective", id, null);
        await client.query("COMMIT");
        const updated = await client.query<{ id: string; name: string; weight: number }>(
          "SELECT id, name, weight FROM objectives WHERE id = $1",
          [id],
        );
        return { status: 200, body: { objective: updated.rows[0] } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
];
