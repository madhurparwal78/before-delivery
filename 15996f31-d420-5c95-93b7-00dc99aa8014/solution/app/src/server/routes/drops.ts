import type { Role, User } from "../../shared/api.js";
import { humanDate, pacificDate } from "../../shared/format.js";
import { audit, one, pool, tx, type Db } from "../db.js";
import { dropTransition, orderTransition, type DropAction } from "../domain/transitions.js";
import { FieldErrors, forbidden, notFound, text, type Reply, type Route } from "../http.js";
import { assess, loadOrders, lockOrder, type DropRecord, type OrderRecord } from "../model.js";
import { dropView } from "../views.js";
import { fileRedirect } from "./files.js";

/** A drop is visible to its own beekeeper and the broker only; anyone else gets 404. Returns its order id. */
async function visibleDrop(db: Db, caller: User, dropId: string): Promise<string> {
  const owner = await one<{ order_id: string; beekeeper_id: string }>(db, "SELECT order_id, beekeeper_id FROM drops WHERE id = $1", [dropId]);
  if (owner === null || !(caller.role === "broker" || owner.beekeeper_id === caller.id)) throw notFound();
  return owner.order_id;
}

async function dropFor(db: Db, user: User, dropId: string, role: Role): Promise<{ caller: User; order: OrderRecord; drop: DropRecord }> {
  const caller = user;
  const orderId = await visibleDrop(db, caller, dropId);
  if (caller.role !== role) throw forbidden();
  const order = await lockOrder(db, orderId);
  const drop = order?.drops.find((entry) => entry.id === dropId);
  if (!order || !drop) throw notFound();
  return { caller, order, drop };
}

async function dropReply(db: Db, caller: User, orderId: string, dropId: string): Promise<Reply> {
  const [order] = await loadOrders(db, "o.id = $1", [orderId]);
  const drop = order?.drops.find((entry) => entry.id === dropId);
  if (!order || !drop) throw notFound();
  return { status: 200, json: dropView(order, assess(order), drop, caller) };
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function review(action: Exclude<DropAction, "deliver" | "inspect">, role: Role): Route {
  return {
    method: "POST",
    path: `/api/drops/:id/${action}`,
    body: "json",
    auth: true,
    handler: ({ user, params, body }) =>
      tx(async (db) => {
        const { caller, order, drop } = await dropFor(db, user, params.id, role);
        const next = dropTransition(action, drop.status);
        const fields = new FieldErrors();
        const reason = action === "dispute" ? text(body.reason, 10, 500) : null;
        const note = action === "resolve" ? text(body.note, 1, 500) : null;
        if (action === "dispute" && reason === null) fields.add("reason", "Reason must be 10 to 500 characters");
        if (action === "resolve" && note === null) fields.add("note", "Note must be 1 to 500 characters");
        fields.throwIfAny();
        await db.query(
          "UPDATE drops SET status = $2, dispute_reason = coalesce($3, dispute_reason), resolution_note = coalesce($4, resolution_note) WHERE id = $1",
          [drop.id, next, reason, note],
        );
        await audit(db, caller.id, action, "drop", drop.id, { reason, note });
        return dropReply(db, caller, order.id, drop.id);
      }),
  };
}

export const dropRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/drops",
    body: "none",
    auth: true,
    async handler({ user }) {
      const caller = user;
      if (caller.role === "grower") throw forbidden();
      const db = await pool.connect();
      try {
        const orders = await loadOrders(
          db,
          "EXISTS (SELECT 1 FROM drops d WHERE d.order_id = o.id AND ($1 = 'broker' OR d.beekeeper_id = $2))",
          [caller.role, caller.id],
        );
        const drops = orders.flatMap((order) => {
          const figures = assess(order);
          return order.drops
            .filter((drop) => caller.role === "broker" || drop.beekeeper.id === caller.id)
            .map((drop) => dropView(order, figures, drop, caller));
        });
        return { status: 200, json: drops };
      } finally {
        db.release();
      }
    },
  },
  {
    method: "GET",
    path: "/api/drops/:id",
    body: "none",
    auth: true,
    async handler({ user, params }) {
      const caller = user;
      const db = await pool.connect();
      try {
        return dropReply(db, caller, await visibleDrop(db, caller, params.id), params.id);
      } finally {
        db.release();
      }
    },
  },
  {
    method: "POST",
    path: "/api/drops/:id/deliver",
    body: "json",
    auth: true,
    handler: ({ user, params, body, now }) =>
      tx(async (db) => {
        const { caller, order, drop } = await dropFor(db, user, params.id, "beekeeper");
        const next = dropTransition("deliver", drop.status);
        orderTransition("deliver", order.status);
        const fields = new FieldErrors();
        const block = assess(order).blocks.find((entry) => entry.block.id === body.block_id);
        if (block === undefined) fields.add("block_id", "Choose a block on this order");
        else if (block.hivesDelivered + drop.hives > block.block.hives_ordered) {
          fields.add("block_id", `${block.block.name} has room for ${block.block.hives_ordered - block.hivesDelivered} more hives`);
        }
        const raw = typeof body.delivered_at === "string" ? body.delivered_at : "";
        const deliveredAt = ISO_INSTANT.test(raw) ? new Date(raw) : null;
        const deliveredOn = deliveredAt !== null && !Number.isNaN(deliveredAt.getTime()) ? pacificDate(deliveredAt) : null;
        if (deliveredAt === null || deliveredOn === null) fields.add("delivered_at", "Use a date and time");
        else if (deliveredAt.getTime() > now.getTime() + 60_000) fields.add("delivered_at", "Delivery time can't be in the future");
        else if (deliveredOn > order.delivery_deadline) fields.add("delivered_at", `Delivered after the delivery deadline (${humanDate(order.delivery_deadline)})`);
        fields.throwIfAny();
        await db.query("UPDATE drops SET status = $2, block_id = $3, delivered_at = $4, delivered_on = $5 WHERE id = $1", [
          drop.id,
          next,
          block?.block.id,
          deliveredAt,
          deliveredOn,
        ]);
        await audit(db, caller.id, "deliver", "drop", drop.id, { block_id: block?.block.id, delivered_on: deliveredOn });
        return dropReply(db, caller, order.id, drop.id);
      }),
  },
  {
    method: "GET",
    path: "/api/photos/:id",
    body: "none",
    auth: true,
    handler: ({ user, params }) =>
      tx(async (db) => {
        const caller = user;
        const photo = await one<{ id: string; object_key: string; content_type: string; beekeeper_id: string; grower_id: string }>(
          db,
          `SELECT p.id, p.object_key, p.content_type, d.beekeeper_id, c.grower_id
             FROM photos p JOIN samples s ON s.id = p.sample_id JOIN drops d ON d.id = s.drop_id
             JOIN orders o ON o.id = p.order_id JOIN orchards c ON c.id = o.orchard_id WHERE p.id = $1`,
          [params.id],
        );
        const allowed =
          photo !== null &&
          (caller.role === "broker" || (caller.role === "grower" && photo.grower_id === caller.id) || (caller.role === "beekeeper" && photo.beekeeper_id === caller.id));
        if (!allowed) throw notFound();
        return fileRedirect(db, photo.object_key, photo.content_type, `${photo.id}.${photo.object_key.split(".").at(-1) ?? ""}`);
      }),
  },
  review("accept", "beekeeper"),
  review("dispute", "beekeeper"),
  review("resolve", "broker"),
];
