import { one, pool, rows, transaction } from "../db.js";
import { COLUMNS, placeParts, type Placement } from "../domain/board.js";
import { HOLD_POSITIONS } from "../domain/holds.js";
import { COORDINATOR, invalid, notFound, route, type Fields, type Reply } from "../http/pipeline.js";
import { pathId, text, wholeIn } from "../http/values.js";
import { loadBoard, loadItems } from "../views.js";

const SHAPES = new Set(["drill", "saw", "ladder", "hammer", "wrench", "case", "battery", "cable", "blade", "generic"]);

async function findItem(id: string | undefined): Promise<number> {
  const itemId = pathId(id);
  if (itemId === null || !(await one(pool, `SELECT 1 FROM items WHERE id = $1`, [itemId]))) throw notFound();
  return itemId;
}

function nameProblem(value: unknown): string | null {
  const name = text(value)?.trim() ?? "";
  return name.length >= 1 && name.length <= 80 ? null : "Enter a name, up to 80 characters.";
}

function costProblem(value: unknown): string | null {
  return wholeIn(value, 1, 1_000_000) ? null : "Enter a cost from $0.01 to $10,000.00.";
}

interface NewPart {
  name: string;
  shape: string;
  width: number;
  height: number;
}

function partsProblem(value: unknown): string | null {
  const problem = "Give 1 to 8 parts, each with a name, a shape and a width and height of 2 to 10 holes.";
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return problem;
  const ok = value.every((part: unknown) => {
    if (part === null || typeof part !== "object") return false;
    const p = part as Record<string, unknown>;
    return nameProblem(p.name) === null && typeof p.shape === "string" && SHAPES.has(p.shape) && wholeIn(p.width, 2, COLUMNS) && wholeIn(p.height, 2, 10);
  });
  return ok ? null : problem;
}

export const itemRoutes = [
  route({
    method: "GET",
    path: "/api/board",
    access: "anyone",
    body: "none",
    handle: async (): Promise<Reply> => ({ status: 200, body: await loadBoard(pool) }),
  }),
  route({
    method: "GET",
    path: "/api/items/:id",
    access: "anyone",
    body: "none",
    find: (ctx) => findItem(ctx.params.id),
    handle: async (ctx, itemId): Promise<Reply> => {
      const [item] = await loadItems(pool, [itemId]);
      if (ctx.caller?.role !== "coordinator" && ctx.caller?.role !== "volunteer") return { status: 200, body: { item } };
      const queue = await rows<{ position: number | null; member_name: string; status: string }>(
        pool,
        `SELECT q.position, u.name AS member_name, h.status FROM holds h JOIN users u ON u.id = h.member_id
         LEFT JOIN (${HOLD_POSITIONS}) q ON q.id = h.id
         WHERE h.item_id = $1 AND h.status IN ('queued','ready') ORDER BY h.status = 'queued', q.position`,
        [itemId],
      );
      return { status: 200, body: { item, queue } };
    },
  }),
  route({
    method: "POST",
    path: "/api/items",
    access: "signed-in",
    roles: COORDINATOR,
    body: "json",
    validate: async (ctx) => {
      const body = ctx.json ?? {};
      const fields: Fields = {};
      const tag = text(body.tag)?.trim() ?? "";
      if (!/^PW-\d{3,5}$/.test(tag)) fields.tag = "Use PW- followed by 3 to 5 digits.";
      else if (await one(pool, `SELECT 1 FROM items WHERE tag = $1`, [tag])) fields.tag = `${tag} is already on the board.`;
      const name = nameProblem(body.name);
      if (name) fields.name = name;
      const cost = costProblem(body.replacement_cost_cents);
      if (cost) fields.replacement_cost_cents = cost;
      const parts = partsProblem(body.parts);
      if (parts) fields.parts = parts;
      return fields;
    },
    handle: async (ctx): Promise<Reply> => {
      const body = ctx.json!;
      const tag = (body.tag as string).trim();
      const parts = (body.parts as NewPart[]).map((p) => ({ ...p, name: p.name.trim() }));
      const itemId = await transaction(async (client) => {
        // One placement at a time so no two tools claim the same holes.
        await client.query(`SELECT pg_advisory_xact_lock(3)`);
        const [created] = await rows<{ id: number }>(
          client,
          `INSERT INTO items (tag, name, replacement_cost_cents) VALUES ($1, $2, $3) ON CONFLICT (tag) DO NOTHING RETURNING id`,
          [tag, (body.name as string).trim(), body.replacement_cost_cents],
        );
        if (!created) throw invalid({ tag: `${tag} is already on the board.` });
        const placed = await rows<Placement>(client, `SELECT col, "row", width, height FROM parts`);
        const spots = placeParts(placed, parts);
        for (const [index, part] of parts.entries()) {
          await client.query(
            `INSERT INTO parts (item_id, name, shape, col, "row", width, height, state) VALUES ($1, $2, $3, $4, $5, $6, $7, 'hung')`,
            [created.id, part.name, part.shape, spots[index]!.col, spots[index]!.row, part.width, part.height],
          );
        }
        return created.id;
      });
      const [item] = await loadItems(pool, [itemId]);
      return { status: 201, body: { item } };
    },
  }),
  route({
    method: "PATCH",
    path: "/api/items/:id",
    access: "signed-in",
    roles: COORDINATOR,
    body: "json",
    find: (ctx) => findItem(ctx.params.id),
    validate: (ctx) => {
      const body = ctx.json ?? {};
      const fields: Fields = {};
      if ("name" in body) {
        const name = nameProblem(body.name);
        if (name) fields.name = name;
      }
      if ("replacement_cost_cents" in body) {
        const cost = costProblem(body.replacement_cost_cents);
        if (cost) fields.replacement_cost_cents = cost;
      }
      return fields;
    },
    handle: async (ctx, itemId): Promise<Reply> => {
      const body = ctx.json!;
      if ("name" in body) await pool.query(`UPDATE items SET name = $2 WHERE id = $1`, [itemId, (body.name as string).trim()]);
      if ("replacement_cost_cents" in body) {
        await pool.query(`UPDATE items SET replacement_cost_cents = $2 WHERE id = $1`, [itemId, body.replacement_cost_cents]);
      }
      const [item] = await loadItems(pool, [itemId]);
      return { status: 200, body: { item } };
    },
  }),
];

