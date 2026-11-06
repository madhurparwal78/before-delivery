import { randomUUID } from "node:crypto";
import { one, pool, rows, transaction, type Db } from "../db";
import { conflict, notFound, type Json } from "../http";
import { route, type Ctx } from "../router";
import { asBody, Fields } from "../validate";
import { FIELD } from "../../shared/copy";
import { visibleYacht, type YachtRow } from "../domain/yachts";

const CATEGORIES = ["provisions", "drinks", "cleaning", "engine_room", "safety"] as const;
const KINDS = ["received", "used", "spoiled"] as const;
const PAGE_CAP = 50;
const STORE_ROLES = ["captain", "crew_member"] as const;

interface ItemRow {
  id: string;
  name: string;
  unit: string;
  category: string;
  received_qty: number;
  used_qty: number;
  spoiled_qty: number;
}

function itemJson(i: ItemRow): Json {
  return {
    id: i.id,
    name: i.name,
    unit: i.unit,
    category: i.category,
    receivedQty: i.received_qty,
    usedQty: i.used_qty,
    spoiledQty: i.spoiled_qty,
    onHandQty: i.received_qty - i.used_qty - i.spoiled_qty,
  };
}

async function storesYacht(ctx: Ctx, db: Db = pool): Promise<YachtRow> {
  const yacht = await visibleYacht(db, ctx.member, ctx.params.slug);
  ctx.allow(STORE_ROLES);
  return yacht;
}

/** The cursor marks the last item returned: unpadded base64url of [lower(name), id]. */
function encodeCursor(item: ItemRow): string {
  return Buffer.from(JSON.stringify([item.name.toLowerCase(), item.id])).toString("base64url");
}

function decodeCursor(text: string): [string, string] | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string"
      && /^[0-9a-f-]{36}$/i.test(value[1])) {
      return [value[0], value[1]];
    }
  } catch {
    return null;
  }
  return null;
}

route("GET", "/api/w/:ws/yachts/:slug/stores", {
  staff: true,
  handle: async (ctx) => {
    const yacht = await storesYacht(ctx);
    const fields = new Fields();
    const q = ctx.query("q") ?? "";
    if ([...q].length > 60) fields.fail("q", FIELD.maxChars(60));
    const limitText = ctx.query("limit");
    let limit = PAGE_CAP;
    if (limitText !== null && limitText !== "") {
      const value = /^\d+$/.test(limitText) ? Number(limitText) : NaN;
      if (!Number.isInteger(value) || value < 1) fields.fail("limit", FIELD.whole(1, PAGE_CAP));
      else limit = Math.min(value, PAGE_CAP);
    }
    const cursorText = ctx.query("cursor");
    const cursor = cursorText ? decodeCursor(cursorText) : null;
    if (cursorText && !cursor) fields.fail("cursor", FIELD.cursor);
    fields.check();
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const found = await rows<ItemRow>(
      pool,
      `SELECT * FROM store_items WHERE yacht_id = $1 AND name ILIKE $2
         AND ($3::text IS NULL OR (lower(name), id) > ($3::text, $4::uuid))
       ORDER BY lower(name), id LIMIT $5`,
      [yacht.id, pattern, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1],
    );
    const page = found.slice(0, limit);
    return {
      status: 200,
      body: { items: page.map(itemJson), nextCursor: found.length > limit ? encodeCursor(page[page.length - 1]) : null },
    };
  },
});

route("POST", "/api/w/:ws/yachts/:slug/stores", {
  staff: true,
  handle: async (ctx) => {
    const yacht = await storesYacht(ctx);
    const body = asBody(await ctx.json());
    const fields = new Fields();
    const name = fields.text("name", body.name, 60);
    const unit = fields.text("unit", body.unit, 20);
    const category = fields.option("category", body.category, CATEGORIES);
    if (name && (await one(pool, "SELECT 1 FROM store_items WHERE yacht_id = $1 AND lower(name) = lower($2)", [yacht.id, name]))) {
      throw conflict("item_exists");
    }
    fields.check();
    try {
      const item = await one<ItemRow>(pool, "INSERT INTO store_items (id, yacht_id, name, unit, category) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [randomUUID(), yacht.id, name, unit, category]);
      return { status: 201, body: { item: itemJson(item!) } };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw conflict("item_exists");
      throw error;
    }
  },
});

async function storeItem(ctx: Ctx, db: Db, lock = false): Promise<ItemRow> {
  const yacht = await visibleYacht(db, ctx.member, ctx.params.slug);
  const item = /^[0-9a-f-]{36}$/i.test(ctx.params.item)
    ? await one<ItemRow>(db, `SELECT * FROM store_items WHERE id = $1 AND yacht_id = $2${lock ? " FOR UPDATE" : ""}`, [ctx.params.item, yacht.id])
    : undefined;
  if (!item) throw notFound();
  ctx.allow(STORE_ROLES);
  return item;
}

route("GET", "/api/w/:ws/yachts/:slug/stores/:item", {
  staff: true,
  handle: async (ctx) => ({ status: 200, body: { item: itemJson(await storeItem(ctx, pool)) } }),
});

route("DELETE", "/api/w/:ws/yachts/:slug/stores/:item", {
  staff: true,
  handle: async (ctx) => {
    const item = await storeItem(ctx, pool);
    await pool.query("DELETE FROM store_items WHERE id = $1", [item.id]);
    return { status: 204 };
  },
});

route("POST", "/api/w/:ws/yachts/:slug/stores/:item/movements", {
  staff: true,
  handle: async (ctx) => {
    await storeItem(ctx, pool);
    const body = asBody(await ctx.json());
    const result = await transaction(async (db) => {
      const item = await storeItem(ctx, db, true);
      const fields = new Fields();
      const kind = fields.option("kind", body.kind, KINDS);
      const quantity = fields.whole("quantity", body.quantity, 1, 100000);
      const onHand = item.received_qty - item.used_qty - item.spoiled_qty;
      if (kind && kind !== "received" && quantity && quantity > onHand) throw conflict("insufficient_stock", { onHandQty: onHand });
      fields.check();
      const movement = (await one<{ id: string; kind: string; quantity: number; logged_by: string; logged_at: Date }>(db,
        "INSERT INTO store_movements (id, item_id, kind, quantity, logged_by, logged_at) VALUES ($1,$2,$3,$4,$5, now()) RETURNING *",
        [randomUUID(), item.id, kind, quantity, ctx.member.name]))!;
      const updated = (await one<ItemRow>(db,
        `UPDATE store_items i SET
           received_qty = coalesce((SELECT sum(quantity) FROM store_movements WHERE item_id = i.id AND kind = 'received'), 0),
           used_qty = coalesce((SELECT sum(quantity) FROM store_movements WHERE item_id = i.id AND kind = 'used'), 0),
           spoiled_qty = coalesce((SELECT sum(quantity) FROM store_movements WHERE item_id = i.id AND kind = 'spoiled'), 0)
         WHERE id = $1 RETURNING *`, [item.id]))!;
      return { movement, updated };
    });
    return {
      status: 201,
      body: {
        movement: {
          id: result.movement.id,
          kind: result.movement.kind,
          quantity: result.movement.quantity,
          loggedBy: result.movement.logged_by,
          loggedAt: result.movement.logged_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
        },
        item: itemJson(result.updated),
      },
    };
  },
});
