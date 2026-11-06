import type { Response } from "express";
import { rows, one, withTransaction } from "../db.ts";
import { ApiError } from "../errors.ts";
import { newId, nextOrderRef } from "../seed.ts";
import {
  loadOrderContext, orderVisibleTo, deliveredHivesByBlock, sha256, newToken, audit,
} from "../store.ts";
import type { RuleSet } from "../domain/model.ts";
import { formatDateText, formatDateTimeText, isValidDate } from "../domain/dates.ts";
import { serializeOrder, serializeOrderList, serializeBrokerOrder } from "./serialize.ts";
import { queueEmail } from "../services/mailer.ts";
import type { AppServices, TypedRequest } from "../context.ts";
import { bodyOf, requireSession, param } from "../context.ts";
import { loadVisibleOrderContexts } from "./visibility.ts";

/** GET /api/orders — the caller's orders. */
export async function listOrders(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  const contexts = await loadVisibleOrderContexts(services.pool, actor);
  res.status(200).json(contexts.map((context) => serializeOrderList(context, actor)));
}

/** GET /api/orders/{id} — the role's order. */
export async function getOrder(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  const context = await loadOrderContext(services.pool, param(req, "id"));
  if (!context || !orderVisibleTo(context, actor)) throw ApiError.notFound();
  res.status(200).json(serializeOrder(context, actor));
}

const BAD_DATE = "Use a date like 2027-02-05";

/** POST /api/orders — the broker drafts an order for an orchard. */
export async function createOrder(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const body = bodyOf(req);
  const fields: Record<string, string> = {};

  const orchardId = typeof body.orchard_id === "string" ? body.orchard_id : "";
  const bloomStart = typeof body.bloom_start === "string" ? body.bloom_start : "";
  const bloomEnd = typeof body.bloom_end === "string" ? body.bloom_end : "";
  const deadline = typeof body.delivery_deadline === "string" ? body.delivery_deadline : "";
  if (!orchardId) fields.orchard_id = "Choose an orchard";
  if (!isValidDate(bloomStart)) fields.bloom_start = BAD_DATE;
  if (!isValidDate(bloomEnd)) fields.bloom_end = BAD_DATE;
  if (!isValidDate(deadline)) fields.delivery_deadline = BAD_DATE;

  const blocksInput = Array.isArray(body.blocks) ? body.blocks : [];
  const parsed: { block_id: string; hives: number }[] = [];
  const seen = new Set<string>();
  blocksInput.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      fields[`blocks.${index}.block_id`] = "That block isn't on this orchard";
      fields[`blocks.${index}.hives`] = "Hives must be a whole number from 1 to 2000";
      return;
    }
    const block = raw as Record<string, unknown>;
    const blockId = typeof block.block_id === "string" ? block.block_id : "";
    const hives = typeof block.hives === "number" ? block.hives : Number.NaN;
    if (!blockId || seen.has(blockId)) {
      fields.blocks = "Order at least one block, each block once";
    } else {
      seen.add(blockId);
    }
    if (!Number.isInteger(hives) || hives < 1 || hives > 2000) {
      fields[`blocks.${index}.hives`] = "Hives must be a whole number from 1 to 2000";
    }
    parsed.push({ block_id: blockId, hives });
  });
  if (parsed.length === 0) fields.blocks = "Order at least one block, each block once";

  const orchard = await one<{ id: string; grower_id: string }>(services.pool, "SELECT id, grower_id FROM orchards WHERE id = $1", [orchardId]);
  if (!orchard) {
    if (!fields.orchard_id) fields.orchard_id = "Choose an orchard";
  } else {
    const orchardBlocks = await rows<{ id: string }>(services.pool, "SELECT id FROM blocks WHERE orchard_id = $1", [orchardId]);
    const known = new Set(orchardBlocks.map((b) => b.id));
    parsed.forEach((block, index) => {
      if (!known.has(block.block_id)) {
        fields[`blocks.${index}.block_id`] = "That block isn't on this orchard";
      }
    });
    if (isValidDate(bloomStart) && isValidDate(deadline) && deadline > bloomStart) {
      fields.delivery_deadline = "Delivery deadline must be on or before bloom start";
    }
    if (isValidDate(bloomStart) && isValidDate(bloomEnd)) {
      const days = (Date.parse(`${bloomEnd}T00:00:00Z`) - Date.parse(`${bloomStart}T00:00:00Z`)) / 86_400_000;
      if (days < 0 || days > 45) {
        fields.bloom_end = "Bloom end must be on or after bloom start and within 45 days of it";
      }
    }
  }
  const ruleSet = isValidDate(bloomStart)
    ? await one<RuleSet>(services.pool, "SELECT * FROM rule_sets WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1", [bloomStart])
    : null;
  if (!ruleSet) fields.bloom_start = "No pay rules cover this bloom start";
  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

  const orderedHives = parsed.reduce((sum, block) => sum + block.hives, 0);
  const deposit = orderedHives * ruleSet!.deposit_per_hive_cents;
  const orderId = newId("ord");
  const ref = await nextOrderRef(services.pool);

  await withTransaction(services.pool, async (client) => {
    await client.query(
      `INSERT INTO orders (id, ref, orchard_id, grower_id, status, bloom_start, bloom_end, delivery_deadline, rule_set_id, deposit_cents)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9)`,
      [orderId, ref, orchard!.id, orchard!.grower_id, bloomStart, bloomEnd, deadline, ruleSet!.id, deposit],
    );
    for (const block of parsed) {
      await client.query("INSERT INTO order_blocks (order_id, block_id, hives) VALUES ($1,$2,$3)", [orderId, block.block_id, block.hives]);
    }
    await audit(client, "order", orderId, "drafted", actor.id);
  });

  const context = await loadOrderContext(services.pool, orderId);
  res.status(201).json(context ? serializeBrokerOrder(context) : {});
}

/** POST /api/orders/{id}/open — invoices the deposit and opens the order. */
export async function openOrder(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const context = await loadOrderContext(services.pool, param(req, "id"));
  if (!context) throw ApiError.notFound();
  if (context.order.status !== "draft") {
    throw ApiError.invalidTransition(context.order.ref, context.order.status);
  }

  const accountId = await services.killbill.ensureAccount({
    id: context.grower.id,
    name: context.grower.name,
    email: context.grower.email,
  });
  const invoiceId = await services.killbill.createChargeInvoice(accountId, [
    { description: `Deposit · ${context.order.ref}`, cents: context.order.deposit_cents },
  ]);

  await withTransaction(services.pool, async (client) => {
    const updated = await client.query(
      `UPDATE orders SET status = 'open', kb_account_id = $2, kb_deposit_invoice_id = $3
       WHERE id = $1 AND status = 'draft'`,
      [context.order.id, accountId, invoiceId],
    );
    if (updated.rowCount === 0) {
      throw ApiError.invalidTransition(context.order.ref, context.order.status);
    }
    await audit(client, "order", context.order.id, "opened", actor.id);
  }).catch(async (error) => {
    if (error instanceof ApiError && error.code === "invalid_transition") {
      await services.killbill.voidInvoice(invoiceId).catch(() => undefined);
    }
    throw error;
  });
  const fresh = await loadOrderContext(services.pool, context.order.id);
  res.status(200).json(fresh ? serializeBrokerOrder(fresh) : {});
}

/** POST /api/orders/{id}/cancel — voids the deposit invoice and cancels. */
export async function cancelOrder(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const context = await loadOrderContext(services.pool, param(req, "id"));
  if (!context) throw ApiError.notFound();
  const status = context.order.status;
  if (status !== "draft" && status !== "open" && status !== "filled") {
    throw ApiError.invalidTransition(context.order.ref, status);
  }
  if (context.drops.some((d) => d.status !== "committed")) {
    throw new ApiError(409, "drops_delivered", `${context.order.ref} has delivered drops and can't be cancelled.`);
  }
  const invoiceId = context.order.kb_deposit_invoice_id;
  if (invoiceId) {
    await services.killbill.voidInvoice(invoiceId);
  }
  await withTransaction(services.pool, async (client) => {
    const updated = await client.query(
      "UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status IN ('draft','open','filled')",
      [context.order.id],
    );
    if (updated.rowCount === 0) {
      throw ApiError.invalidTransition(context.order.ref, status);
    }
    await audit(client, "order", context.order.id, "cancelled", actor.id);
  });
  const fresh = await loadOrderContext(services.pool, context.order.id);
  res.status(200).json(fresh ? serializeBrokerOrder(fresh) : {});
}

/** POST /api/orders/{id}/place — marks placed and confirms to the grower. */
export async function placeOrder(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const context = await loadOrderContext(services.pool, param(req, "id"));
  if (!context) throw ApiError.notFound();
  if (context.order.status !== "filled") {
    throw ApiError.invalidTransition(context.order.ref, context.order.status);
  }
  if (context.drops.some((d) => d.status === "committed")) {
    throw new ApiError(409, "drops_not_delivered", `Every drop on ${context.order.ref} must be delivered first.`);
  }

  const delivered = deliveredHivesByBlock(context);
  const body = context.blocks
    .map((block) => {
      const latest = context.drops
        .filter((d) => d.block_id === block.id && d.delivered_on)
        .map((d) => d.delivered_on!)
        .sort()
        .at(-1);
      return `${block.name}: ${delivered.get(block.id) ?? 0} hives, delivered ${latest ? formatDateText(latest) : "—"}`;
    })
    .join("\n");

  await withTransaction(services.pool, async (client) => {
    const updated = await client.query(
      "UPDATE orders SET status = 'placed' WHERE id = $1 AND status = 'filled'",
      [context.order.id],
    );
    if (updated.rowCount === 0) {
      throw ApiError.invalidTransition(context.order.ref, context.order.status);
    }
    await queueEmail(client, {
      to: context.grower.email,
      subject: `Hives placed: ${context.orchard.name} · ${context.order.ref}`,
      body,
    });
    await audit(client, "order", context.order.id, "placed", actor.id);
  });
  services.mailer.kick();
  const fresh = await loadOrderContext(services.pool, context.order.id);
  res.status(200).json(fresh ? serializeBrokerOrder(fresh) : {});
}

/** POST /api/orders/{id}/inspection-links — emails one one-orchard link. */
export async function issueInspectionLink(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const context = await loadOrderContext(services.pool, param(req, "id"));
  if (!context) throw ApiError.notFound();
  if (context.order.status !== "placed") {
    throw ApiError.invalidTransition(context.order.ref, context.order.status);
  }
  const body = bodyOf(req);
  const inspectorEmail = typeof body.inspector_email === "string" ? body.inspector_email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inspectorEmail)) {
    throw ApiError.validation({ inspector_email: "Enter an email address like name@example.com" });
  }

  const token = newToken();
  const linkId = newId("lnk");
  const expiresAt = new Date(Date.now() + services.config.inspectionLinkTtlSeconds * 1000);

  await withTransaction(services.pool, async (client) => {
    await client.query(
      "UPDATE inspection_links SET status = 'expired' WHERE order_id = $1 AND status IN ('issued','used')",
      [context.order.id],
    );
    await client.query(
      `INSERT INTO inspection_links (id, order_id, token_hash, inspector_email, status, expires_at)
       VALUES ($1,$2,$3,$4,'issued',$5)`,
      [linkId, context.order.id, sha256(token), inspectorEmail, expiresAt.toISOString()],
    );
    await queueEmail(client, {
      to: inspectorEmail,
      subject: `Inspection sheet: ${context.orchard.name} · ${context.order.ref}`,
      body:
        `${services.config.appBaseUrl}/inspect/${token}\n` +
        `This link opens only this orchard's inspection sheet. It stops working when you sign the report or at ${formatDateTimeText(expiresAt)} Pacific.`,
    });
    await audit(client, "inspection_link", linkId, "issued", actor.id);
  });
  services.mailer.kick();
  res.status(201).json({
    id: linkId,
    status: "issued",
    inspector_email: inspectorEmail,
    expires_at: expiresAt.toISOString(),
  });
}

/** GET /api/orders/{id}/report — 302 to a short-lived link for the signed PDF. */
export async function orderReport(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  const context = await loadOrderContext(services.pool, param(req, "id"));
  if (!context) throw ApiError.notFound();
  const allowed =
    actor.role === "broker" ||
    (actor.role === "grower" && context.grower.id === actor.id) ||
    (actor.role === "beekeeper" && context.drops.some((d) => d.beekeeper_id === actor.id));
  if (!allowed || context.order.signed_at === null || !context.order.report_key) throw ApiError.notFound();
  const token = newToken();
  await services.pool.query(
    "INSERT INTO file_links (token_hash, kind, order_id, expires_at) VALUES ($1,'report',$2,$3)",
    [sha256(token), context.order.id, new Date(Date.now() + services.config.fileUrlTtlSeconds * 1000).toISOString()],
  );
  res.setHeader("Location", `/files/${token}`);
  res.status(302).end();
}
