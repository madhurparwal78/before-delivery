import type { OrchardSummary, OrderStatus, Ref, User } from "../../shared/api.js";
import { newId } from "../auth.js";
import { audit, pool, rows, tx } from "../db.js";
import { FieldErrors, tenths, text, type Route } from "../http.js";
import { canSee } from "../model.js";
import { brokerOnly } from "./session.js";

interface OrchardRow {
  id: string;
  name: string;
  county: string;
  grower_id: string;
  grower_name: string;
}

interface OrderLite {
  id: string;
  ref: string;
  status: OrderStatus;
  bloom_start: string;
  growerId: string;
  beekeeperIds: string[];
}

interface Orchard {
  id: string;
  name: string;
  county: string;
  grower: Ref;
  blocks: OrchardSummary["blocks"];
  orders: OrderLite[];
}

/** The orchard as the caller may see it: only visible orders; the grower only for the broker. */
function present(caller: User, orchard: Orchard): OrchardSummary {
  return {
    id: orchard.id,
    name: orchard.name,
    county: orchard.county,
    blocks: orchard.blocks,
    orders: orchard.orders.filter((order) => canSee(caller, order)).map(({ id, ref, status, bloom_start }) => ({ id, ref, status, bloom_start })),
    ...(caller.role === "broker" ? { grower: orchard.grower } : {}),
  };
}

async function loadOrchards(where: string, params: unknown[]): Promise<Orchard[]> {
  const orchards = await rows<OrchardRow>(
    pool,
    `SELECT c.id, c.name, c.county, c.grower_id, u.name AS grower_name FROM orchards c JOIN users u ON u.id = c.grower_id
      WHERE ${where} ORDER BY c.seq DESC`,
    params,
  );
  const ids = orchards.map((orchard) => orchard.id);
  const [blocks, orders] = await Promise.all([
    rows<{ id: string; orchard_id: string; name: string; acres_tenths: number }>(
      pool,
      "SELECT id, orchard_id, name, acres_tenths FROM blocks WHERE orchard_id = ANY($1) ORDER BY position",
      [ids],
    ),
    rows<{ id: string; orchard_id: string; ref: string; status: OrderStatus; bloom_start: string; beekeeper_ids: string[] }>(
      pool,
      `SELECT o.id, o.orchard_id, o.ref, o.status, o.bloom_start,
              coalesce(array_agg(DISTINCT d.beekeeper_id) FILTER (WHERE d.id IS NOT NULL), '{}') AS beekeeper_ids
         FROM orders o LEFT JOIN drops d ON d.order_id = o.id WHERE o.orchard_id = ANY($1)
        GROUP BY o.id ORDER BY o.bloom_start DESC, o.seq DESC`,
      [ids],
    ),
  ]);
  return orchards.map((orchard) => ({
    id: orchard.id,
    name: orchard.name,
    county: orchard.county,
    blocks: blocks.filter((block) => block.orchard_id === orchard.id).map((block) => ({ id: block.id, name: block.name, acres: block.acres_tenths / 10 })),
    orders: orders
      .filter((order) => order.orchard_id === orchard.id)
      .map((order) => ({ id: order.id, ref: order.ref, status: order.status, bloom_start: order.bloom_start, growerId: orchard.grower_id, beekeeperIds: order.beekeeper_ids })),
    grower: { id: orchard.grower_id, name: orchard.grower_name },
  }));
}

export const orchardRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/orchards",
    body: "none",
    auth: true,
    async handler({ user }) {
      const caller = user;
      const all = await loadOrchards(caller.role === "grower" ? "c.grower_id = $1" : "$1::text IS NOT NULL", [caller.id]);
      const visible = all.map((orchard) => present(caller, orchard)).filter((orchard) => caller.role !== "beekeeper" || orchard.orders.length > 0);
      return { status: 200, json: visible };
    },
  },
  {
    method: "POST",
    path: "/api/orchards",
    body: "json",
    auth: true,
    async handler({ user, body }) {
      const broker = brokerOnly(user);
      const fields = new FieldErrors();
      const growerId = typeof body.grower_id === "string" ? body.grower_id : "";
      const [grower] = await rows<{ id: string }>(pool, "SELECT id FROM users WHERE id = $1 AND role = 'grower'", [growerId]);
      if (!grower) fields.add("grower_id", "Choose a grower");
      const name = text(body.name, 1, 80);
      if (name === null) fields.add("name", "Orchard name must be 1 to 80 characters");
      const county = text(body.county, 1, 40);
      if (county === null) fields.add("county", "County must be 1 to 40 characters");
      const blocks = Array.isArray(body.blocks) ? (body.blocks as unknown[]) : [];
      if (blocks.length < 1 || blocks.length > 12) fields.add("blocks", "An orchard needs 1 to 12 blocks");
      const parsed = blocks.map((entry, index) => {
        const item = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
        const blockName = text(item.name, 1, 30);
        const acres = tenths(item.acres, 10, 5000);
        if (acres === null) fields.add(`blocks.${index}.acres`, "Acres must be between 1 and 500 with at most one decimal");
        return { name: blockName, acres, index };
      });
      for (const block of parsed) {
        const duplicate = parsed.some((other) => other.index !== block.index && other.name !== null && other.name.toLowerCase() === block.name?.toLowerCase());
        if (block.name === null || duplicate) fields.add(`blocks.${block.index}.name`, "Block names must be 1 to 30 characters and unique in the orchard");
      }
      fields.throwIfAny();
      const orchardId = newId("orc");
      await tx(async (db) => {
        await db.query("INSERT INTO orchards (id, grower_id, name, county) VALUES ($1, $2, $3, $4)", [orchardId, growerId, name, county]);
        for (const block of parsed) {
          await db.query("INSERT INTO blocks (id, orchard_id, name, acres_tenths, position) VALUES ($1, $2, $3, $4, $5)", [
            newId("blk"),
            orchardId,
            block.name,
            block.acres,
            block.index,
          ]);
        }
        await audit(db, broker.id, "create", "orchard", orchardId, { name });
      });
      const [created] = await loadOrchards("c.id = $1", [orchardId]);
      return { status: 201, json: present(broker, created) };
    },
  },
];
