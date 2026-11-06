import type { Response } from "express";
import { rows, one, withTransaction } from "../db.ts";
import { ApiError } from "../errors.ts";
import {
  loadDropContext, commitTruckload, assertDropAction, pacificDateOf, audit, sha256, newToken,
  deliveredHivesByBlock, type DropRow,
} from "../store.ts";
import { formatDateText } from "../domain/dates.ts";
import { serializeDrop } from "./serialize.ts";
import type { AppServices, TypedRequest } from "../context.ts";
import { bodyOf, requireSession, param } from "../context.ts";
import { loadOrderRow } from "./visibility.ts";

/** POST /api/orders/{id}/drops — a beekeeper commits a truckload. */
export async function commitDrop(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "beekeeper") throw ApiError.notFound();
  const order = await loadOrderRow(services.pool, param(req, "id"));
  if (!order) throw ApiError.notFound();
  if (order.status !== "open") {
    if (order.status === "filled" || order.status === "placed" || order.status === "inspected" || order.status === "settled") {
      throw new ApiError(409, "not_enough_open_hives", "No hives are open on this order.", { remaining: 0 });
    }
    throw ApiError.invalidTransition(order.ref, order.status);
  }
  const body = bodyOf(req);
  const fields: Record<string, string> = {};
  const yardName = typeof body.yard_name === "string" ? body.yard_name.trim() : "";
  const hives = typeof body.hives === "number" ? body.hives : Number.NaN;
  if (yardName.length < 1 || yardName.length > 60) fields.yard_name = "Yard name must be 1 to 60 characters";
  if (!Number.isInteger(hives) || hives < 1 || hives > 1000) fields.hives = "Hives must be a whole number from 1 to 1000";
  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

  const drop = await commitTruckload(services.pool, order.id, actor.id, yardName, hives);
  const full = await loadDropContext(services.pool, drop.id);
  res.status(201).json(full ? serializeDrop(full.context, full.drop, "beekeeper") : {});
}

/** GET /api/drops — the beekeeper's own drops, or all drops for the broker. */
export async function listDrops(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role === "grower") throw ApiError.forbidden();
  const dropRows = actor.role === "broker"
    ? await rows<DropRow>(services.pool, "SELECT * FROM drops ORDER BY created_at, id")
    : await rows<DropRow>(services.pool, "SELECT * FROM drops WHERE beekeeper_id = $1 ORDER BY created_at, id", [actor.id]);
  const payload = [];
  for (const drop of dropRows) {
    const full = await loadDropContext(services.pool, drop.id);
    if (full) payload.push(serializeDrop(full.context, full.drop, actor.role === "broker" ? "broker" : "beekeeper"));
  }
  res.status(200).json(payload);
}

/** GET /api/drops/{id} — the owning beekeeper's or the broker's drop. */
export async function getDrop(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  const full = await loadDropContext(services.pool, param(req, "id"));
  if (!full) throw ApiError.notFound();
  const owns = full.drop.beekeeper_id === actor.id;
  if (actor.role !== "broker" && !owns) throw ApiError.notFound();
  res.status(200).json(serializeDrop(full.context, full.drop, actor.role === "broker" ? "broker" : "beekeeper"));
}

/** POST /api/drops/{id}/deliver — logs a committed truckload into a block. */
export async function deliverDrop(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  const full = await loadDropContext(services.pool, param(req, "id"));
  if (!full || full.drop.beekeeper_id !== actor.id) throw ApiError.notFound();
  const { drop, context } = full;
  assertDropAction(context.order.ref, drop.status, "deliver");
  if (context.order.status !== "open" && context.order.status !== "filled") {
    throw ApiError.invalidTransition(context.order.ref, context.order.status);
  }

  const body = bodyOf(req);
  const blockId = typeof body.block_id === "string" ? body.block_id : "";
  const deliveredAtRaw = typeof body.delivered_at === "string" ? body.delivered_at : "";
  const fields: Record<string, string> = {};
  const block = context.blocks.find((b) => b.id === blockId);
  if (!block) {
    fields.block_id = "Choose a block on this order";
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(deliveredAtRaw)) {
    fields.delivered_at = "Use a date and time";
  } else {
    const deliveredAt = new Date(deliveredAtRaw);
    if (Number.isNaN(deliveredAt.getTime())) {
      fields.delivered_at = "Use a date and time";
    } else if (deliveredAt.getTime() - Date.now() > 60_000) {
      fields.delivered_at = "Delivery time can't be in the future";
    } else {
      const deliveredOn = pacificDateOf(deliveredAt);
      if (deliveredOn > context.order.delivery_deadline) {
        fields.delivered_at = `Delivered after the delivery deadline (${formatDateText(context.order.delivery_deadline)})`;
      }
      if (block) {
        const delivered = deliveredHivesByBlock(context);
        const room = block.hives_ordered - (delivered.get(block.id) ?? 0);
        if (drop.hives > room) {
          fields.block_id = `${block.name} has room for ${room} more hives`;
        }
      }
    }
  }
  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

  const deliveredAt = new Date(deliveredAtRaw);
  const deliveredOn = pacificDateOf(deliveredAt);
  await withTransaction(services.pool, async (client) => {
    const updated = await client.query(
      `UPDATE drops SET status = 'delivered', block_id = $2, delivered_at = $3, delivered_on = $4
       WHERE id = $1 AND status = 'committed'`,
      [drop.id, blockId, deliveredAt.toISOString(), deliveredOn],
    );
    if (updated.rowCount === 0) {
      throw ApiError.invalidTransition(context.order.ref, drop.status);
    }
    await audit(client, "drop", drop.id, "delivered", actor.id);
  });
  const fresh = await loadDropContext(services.pool, drop.id);
  res.status(200).json(fresh ? serializeDrop(fresh.context, fresh.drop, "beekeeper") : {});
}

/** POST /api/drops/{id}/accept — the owning beekeeper accepts the inspection. */
export async function acceptDrop(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  const full = await loadDropContext(services.pool, param(req, "id"));
  if (!full || full.drop.beekeeper_id !== actor.id) throw ApiError.notFound();
  const { drop, context } = full;
  assertDropAction(context.order.ref, drop.status, "accept");
  await withTransaction(services.pool, async (client) => {
    const updated = await client.query("UPDATE drops SET status = 'accepted' WHERE id = $1 AND status = 'inspected'", [drop.id]);
    if (updated.rowCount === 0) {
      throw ApiError.invalidTransition(context.order.ref, drop.status);
    }
    await audit(client, "drop", drop.id, "accepted", actor.id);
  });
  const fresh = await loadDropContext(services.pool, drop.id);
  res.status(200).json(fresh ? serializeDrop(fresh.context, fresh.drop, "beekeeper") : {});
}

/** POST /api/drops/{id}/dispute — the owning beekeeper disputes the inspection. */
export async function disputeDrop(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  const full = await loadDropContext(services.pool, param(req, "id"));
  if (!full || full.drop.beekeeper_id !== actor.id) throw ApiError.notFound();
  const { drop, context } = full;
  assertDropAction(context.order.ref, drop.status, "dispute");
  const body = bodyOf(req);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 500) {
    throw ApiError.validation({ reason: "Reason must be 10 to 500 characters" });
  }
  await withTransaction(services.pool, async (client) => {
    const updated = await client.query(
      "UPDATE drops SET status = 'disputed', dispute_reason = $2 WHERE id = $1 AND status = 'inspected'",
      [drop.id, reason],
    );
    if (updated.rowCount === 0) {
      throw ApiError.invalidTransition(context.order.ref, drop.status);
    }
    await audit(client, "drop", drop.id, "disputed", actor.id);
  });
  const fresh = await loadDropContext(services.pool, drop.id);
  res.status(200).json(fresh ? serializeDrop(fresh.context, fresh.drop, "beekeeper") : {});
}

/** POST /api/drops/{id}/resolve — the broker resolves a dispute to accepted. */
export async function resolveDrop(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const full = await loadDropContext(services.pool, param(req, "id"));
  if (!full) throw ApiError.notFound();
  const { drop, context } = full;
  assertDropAction(context.order.ref, drop.status, "resolve");
  const body = bodyOf(req);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length < 1 || note.length > 500) {
    throw ApiError.validation({ note: "Note must be 1 to 500 characters" });
  }
  await withTransaction(services.pool, async (client) => {
    const updated = await client.query(
      "UPDATE drops SET status = 'accepted', resolution_note = $2 WHERE id = $1 AND status = 'disputed'",
      [drop.id, note],
    );
    if (updated.rowCount === 0) {
      throw ApiError.invalidTransition(context.order.ref, drop.status);
    }
    await audit(client, "drop", drop.id, "resolved", actor.id);
  });
  const fresh = await loadDropContext(services.pool, drop.id);
  res.status(200).json(fresh ? serializeDrop(fresh.context, fresh.drop, "broker") : {});
}

/** GET /api/photos/{id} — 302 to a short-lived photo link. */
export async function photoFile(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  const photo = await one<{ id: string; sample_id: string }>(services.pool, "SELECT id, sample_id FROM photos WHERE id = $1", [param(req, "id")]);
  if (!photo) throw ApiError.notFound();
  const sample = await one<{ order_id: string; drop_id: string }>(services.pool, "SELECT order_id, drop_id FROM samples WHERE id = $1", [photo.sample_id]);
  if (!sample) throw ApiError.notFound();
  const drop = await one<DropRow>(services.pool, "SELECT * FROM drops WHERE id = $1", [sample.drop_id]);
  const order = await one<{ grower_id: string }>(services.pool, "SELECT grower_id FROM orders WHERE id = $1", [sample.order_id]);
  const allowed =
    actor.role === "broker" ||
    (drop && drop.beekeeper_id === actor.id) ||
    (actor.role === "grower" && order?.grower_id === actor.id);
  if (!allowed || !drop || !order) throw ApiError.notFound();
  const token = newToken();
  await services.pool.query(
    "INSERT INTO file_links (token_hash, kind, photo_id, expires_at) VALUES ($1,'photo',$2,$3)",
    [sha256(token), photo.id, new Date(Date.now() + services.config.fileUrlTtlSeconds * 1000).toISOString()],
  );
  res.setHeader("Location", `/files/${token}`);
  res.status(302).end();
}
