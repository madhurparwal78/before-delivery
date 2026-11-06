import type { User } from "../../shared/api.js";
import { addDays, countyName, humanDate, humanDateTime, pacificDate, parseIsoDate } from "../../shared/format.js";
import { hashToken, newId, newToken } from "../auth.js";
import { config } from "../config.js";
import { audit, one, pool, rows, tx, type Db } from "../db.js";
import { isDelivered, orderTransition, statusAfterCommit } from "../domain/transitions.js";
import { conflict, FieldErrors, forbidden, notFound, text, wholeNumber, type Reply, type Route } from "../http.js";
import { idempotencyKey, remember, replay, requireKey } from "../idempotency.js";
import { assess, canSeeOrder, loadOrder, loadOrders, lockOrder, ruleSetFor, type OrderRecord } from "../model.js";
import { queueMail } from "../services/mailer.js";
import { growerAccount, invoiceCharges, voidInvoice } from "../services/killbill.js";
import { completeSettlement, isBillingOutage } from "../settlement.js";
import { dropView, orderListView, orderView, settlementView } from "../views.js";
import { fileRedirect } from "./files.js";
import { brokerOnly } from "./session.js";

/** Steps 4 and 5 of the precedence: unknown or invisible → 404, visible but the wrong role → 403. */
async function orderFor(
  db: Db,
  user: User,
  orderId: string,
  role: User["role"],
  visible: (caller: User, order: OrderRecord) => boolean = canSeeOrder,
): Promise<{ caller: User; order: OrderRecord }> {
  const caller = user;
  const order = await lockOrder(db, orderId);
  if (order === null || !visible(caller, order)) throw notFound();
  if (caller.role !== role) throw forbidden();
  return { caller, order };
}

async function brokerOrderReply(db: Db, broker: User, orderId: string, status = 200): Promise<Reply> {
  const order = await loadOrder(db, orderId);
  if (order === null) throw notFound();
  return { status, json: orderView(order, broker) };
}

const VISIBLE_WHERE: Record<User["role"], string> = {
  broker: "$1::text IS NOT NULL",
  grower: "c.grower_id = $1",
  beekeeper: "(o.status = 'open' OR EXISTS (SELECT 1 FROM drops d WHERE d.order_id = o.id AND d.beekeeper_id = $1))",
};

export const orderRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/orders",
    body: "json",
    auth: true,
    async handler({ user, body }) {
      const caller = brokerOnly(user);
      const fields = new FieldErrors();
      const orchardId = typeof body.orchard_id === "string" ? body.orchard_id : "";
      const orchardBlocks = await rows<{ id: string }>(pool, "SELECT id FROM blocks WHERE orchard_id = $1", [orchardId]);
      const orchard = await one<{ id: string }>(pool, "SELECT id FROM orchards WHERE id = $1", [orchardId]);
      if (orchard === null) fields.add("orchard_id", "Choose an orchard");
      const requested = Array.isArray(body.blocks) ? (body.blocks as unknown[]) : [];
      const lines = requested.map((entry) => (typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {}));
      const blockIds = lines.map((line) => line.block_id);
      if (lines.length === 0 || new Set(blockIds.map(String)).size !== blockIds.length) fields.add("blocks", "Order at least one block, each block once");
      lines.forEach((line, index) => {
        if (orchard !== null && !orchardBlocks.some((block) => block.id === line.block_id)) fields.add(`blocks.${index}.block_id`, "That block isn't on this orchard");
        if (wholeNumber(line.hives, 1, 2000) === null) fields.add(`blocks.${index}.hives`, "Hives must be a whole number from 1 to 2000");
      });
      const dateMessage = "Use a date like 2027-02-05";
      const start = parseIsoDate(body.bloom_start);
      const end = parseIsoDate(body.bloom_end);
      const deadline = parseIsoDate(body.delivery_deadline);
      if (start === null) fields.add("bloom_start", dateMessage);
      if (end === null) fields.add("bloom_end", dateMessage);
      if (deadline === null) fields.add("delivery_deadline", dateMessage);
      const db = await pool.connect();
      try {
        const rule = start === null ? null : await ruleSetFor(db, start);
        if (start !== null && rule === null) fields.add("bloom_start", "No pay rules cover this bloom start");
        if (start !== null && end !== null && (end < start || end > addDays(start, 45))) {
          fields.add("bloom_end", "Bloom end must be on or after bloom start and within 45 days of it");
        }
        if (start !== null && deadline !== null && deadline > start) fields.add("delivery_deadline", "Delivery deadline must be on or before bloom start");
        fields.throwIfAny();
        const orderId = newId("ord");
        await db.query("BEGIN");
        try {
          const ref = await one<{ ref: string }>(db, "SELECT 'BD-' || nextval('order_ref_seq') AS ref");
          await db.query(
            `INSERT INTO orders (id, ref, orchard_id, rule_set_id, status, bloom_start, bloom_end, delivery_deadline)
             VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7)`,
            [orderId, ref?.ref, orchardId, rule?.id, start, end, deadline],
          );
          for (const [index, line] of lines.entries()) {
            await db.query("INSERT INTO order_blocks (order_id, block_id, hives, position) VALUES ($1, $2, $3, $4)", [orderId, line.block_id, line.hives, index]);
          }
          await audit(db, caller.id, "draft", "order", orderId, { ref: ref?.ref });
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK");
          throw error;
        }
        return brokerOrderReply(db, caller, orderId, 201);
      } finally {
        db.release();
      }
    },
  },
  {
    method: "GET",
    path: "/api/orders",
    body: "none",
    auth: true,
    async handler({ user }) {
      const caller = user;
      const db = await pool.connect();
      try {
        const orders = await loadOrders(db, VISIBLE_WHERE[caller.role], [caller.id]);
        return { status: 200, json: orders.filter((order) => canSeeOrder(caller, order)).map((order) => orderListView(order, caller)) };
      } finally {
        db.release();
      }
    },
  },
  {
    method: "GET",
    path: "/api/orders/:id",
    body: "none",
    auth: true,
    async handler({ user, params }) {
      const caller = user;
      const db = await pool.connect();
      try {
        const order = await loadOrder(db, params.id);
        if (order === null || !canSeeOrder(caller, order)) throw notFound();
        return { status: 200, json: orderView(order, caller) };
      } finally {
        db.release();
      }
    },
  },
  {
    method: "POST",
    path: "/api/orders/:id/open",
    body: "json",
    auth: true,
    handler: ({ user, params }) =>
      tx(async (db, undo) => {
        const { caller, order } = await orderFor(db, user, params.id, "broker");
        const next = orderTransition("open", order.status);
        const account = await growerAccount(db, order.orchard.grower_id);
        const invoiceId = await invoiceCharges(account, [{ cents: assess(order).depositCents, description: `Deposit · ${order.ref}` }]);
        undo(() => voidInvoice(invoiceId));
        await db.query("UPDATE orders SET status = $2, deposit_invoice_id = $3 WHERE id = $1", [order.id, next, invoiceId]);
        await audit(db, caller.id, "open", "order", order.id, { invoice_id: invoiceId });
        return brokerOrderReply(db, caller, order.id);
      }),
  },
  {
    method: "POST",
    path: "/api/orders/:id/cancel",
    body: "json",
    auth: true,
    handler: ({ user, params }) =>
      tx(async (db) => {
        const { caller, order } = await orderFor(db, user, params.id, "broker");
        const next = orderTransition("cancel", order.status);
        if (order.drops.some((drop) => isDelivered(drop.status))) throw conflict("drops_delivered", `${order.ref} has delivered drops and can't be cancelled.`);
        if (order.deposit_invoice_id !== null) await voidInvoice(order.deposit_invoice_id);
        await db.query("UPDATE orders SET status = $2 WHERE id = $1", [order.id, next]);
        await audit(db, caller.id, "cancel", "order", order.id, { voided_invoice_id: order.deposit_invoice_id });
        return brokerOrderReply(db, caller, order.id);
      }),
  },
  {
    method: "POST",
    path: "/api/orders/:id/drops",
    body: "json",
    auth: true,
    handler: ({ user, params, body }) =>
      tx(async (db) => {
        const { caller, order } = await orderFor(db, user, params.id, "beekeeper");
        const figures = assess(order);
        const remaining = figures.hivesRemaining;
        const refusal = (left: number) => conflict("not_enough_open_hives", `Only ${left} hives are still open on ${order.ref}.`, left);
        if (order.status === "filled") throw refusal(0);
        orderTransition("commit", order.status);
        const hives = wholeNumber(body.hives, 1, 1000);
        if (hives !== null && hives > remaining) throw refusal(remaining);
        const fields = new FieldErrors();
        const yard = text(body.yard_name, 1, 60);
        if (yard === null) fields.add("yard_name", "Yard name must be 1 to 60 characters");
        if (hives === null) fields.add("hives", "Hives must be a whole number from 1 to 1000");
        fields.throwIfAny();
        const dropId = newId("drp");
        await db.query("INSERT INTO drops (id, order_id, beekeeper_id, yard_name, hives, status) VALUES ($1, $2, $3, $4, $5, 'committed')", [
          dropId,
          order.id,
          caller.id,
          yard,
          hives,
        ]);
        await db.query("UPDATE orders SET status = $2 WHERE id = $1", [order.id, statusAfterCommit(figures.hivesCommitted + (hives ?? 0), figures.hivesOrdered)]);
        await audit(db, caller.id, "commit", "drop", dropId, { order_id: order.id, hives });
        const updated = await loadOrder(db, order.id);
        const drop = updated?.drops.find((entry) => entry.id === dropId);
        if (!updated || !drop) throw notFound();
        return { status: 201, json: dropView(updated, assess(updated), drop, caller) };
      }),
  },
  {
    method: "POST",
    path: "/api/orders/:id/place",
    body: "json",
    auth: true,
    handler: ({ user, params }) =>
      tx(async (db) => {
        const { caller, order } = await orderFor(db, user, params.id, "broker");
        const next = orderTransition("place", order.status);
        if (order.drops.some((drop) => !isDelivered(drop.status))) throw conflict("drops_not_delivered", `Every drop on ${order.ref} must be delivered first.`);
        await db.query("UPDATE orders SET status = $2 WHERE id = $1", [order.id, next]);
        const grower = await one<{ email: string; contact_name: string }>(db, "SELECT email, contact_name FROM users WHERE id = $1", [order.orchard.grower_id]);
        const lines = assess(order).blocks.map((entry) => {
          const latest = order.drops
            .filter((drop) => drop.block_id === entry.block.id && drop.delivered_on !== null)
            .map((drop) => drop.delivered_on ?? "")
            .sort()
            .at(-1);
          return `${entry.block.name}: ${entry.hivesDelivered} hives, delivered ${latest ? humanDate(latest) : "not yet"}`;
        });
        await queueMail(db, {
          to: grower?.email ?? "",
          subject: `Hives placed: ${order.orchard.name} · ${order.ref}`,
          body: [
            `Hello ${grower?.contact_name ?? ""},`,
            "",
            `Every hive for ${order.orchard.name} (${countyName(order.orchard.county)}) on order ${order.ref} is placed.`,
            "",
            ...lines,
            "",
            "The inspector's strength report will follow during bloom.",
            "",
            "Swarmline Bloom Desk",
          ].join("\n"),
        });
        await audit(db, caller.id, "place", "order", order.id);
        return brokerOrderReply(db, caller, order.id);
      }),
  },
  {
    method: "POST",
    path: "/api/orders/:id/inspection-links",
    body: "json",
    auth: true,
    handler: ({ user, params, body, now }) =>
      tx(async (db) => {
        const { caller, order } = await orderFor(db, user, params.id, "broker");
        orderTransition("issue_link", order.status);
        const fields = new FieldErrors();
        const email = text(body.inspector_email, 3, 254);
        if (email === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.add("inspector_email", "Enter an email address like name@example.com");
        fields.throwIfAny();
        const linkId = newId("lnk");
        const token = newToken();
        const expiresAt = new Date(now.getTime() + config.inspectionLinkTtlSeconds * 1000);
        await db.query("UPDATE inspection_links SET status = 'expired' WHERE order_id = $1 AND status IN ('issued', 'used')", [order.id]);
        await db.query(
          "INSERT INTO inspection_links (id, order_id, token_hash, inspector_email, status, issued_at, expires_at) VALUES ($1, $2, $3, $4, 'issued', $5, $6)",
          [linkId, order.id, hashToken(token), email, now, expiresAt],
        );
        await queueMail(db, {
          to: email ?? "",
          subject: `Inspection sheet: ${order.orchard.name} · ${order.ref}`,
          body: [
            "Hello,",
            "",
            `You have been asked to inspect ${order.orchard.name} (${countyName(order.orchard.county)}) for order ${order.ref}.`,
            "Open the inspection sheet on your phone; no sign-in is needed:",
            "",
            `${config.baseUrl}/inspect/${token}`,
            "",
            `This link opens only this orchard's inspection sheet. It stops working when you sign the report or at ${humanDateTime(expiresAt)} Pacific.`,
            "",
            "Swarmline Bloom Desk",
          ].join("\n"),
        });
        await audit(db, caller.id, "issue_link", "inspection_link", linkId, { order_id: order.id, inspector_email: email });
        return { status: 201, json: { id: linkId, status: "issued", inspector_email: email, expires_at: expiresAt.toISOString() } };
      }),
  },
  {
    method: "GET",
    path: "/api/orders/:id/settlement",
    body: "none",
    auth: true,
    handler: ({ user, params }) =>
      tx(async (db) => {
        const { order } = await orderFor(db, user, params.id, "broker");
        return { status: 200, json: settlementView(order) };
      }),
  },
  {
    method: "POST",
    path: "/api/orders/:id/settle",
    body: "json",
    auth: true,
    handler: (ctx) =>
      tx(async (db) => {
        const { caller, order } = await orderFor(db, ctx.user, ctx.params.id, "broker");
        const scope = `settle:${order.id}`;
        const key = idempotencyKey(ctx);
        const replayed = await replay(db, scope, key, ctx.body);
        if (replayed) return replayed;
        if (order.settlement !== null) throw conflict("already_settled", `${order.orchard.name} is already settled.`);
        orderTransition("settle", order.status);
        if (order.drops.some((drop) => drop.status !== "accepted")) {
          throw conflict("drops_not_accepted", `Every drop must be accepted before ${order.orchard.name} can be settled.`);
        }
        const fields = new FieldErrors();
        const paidOn = parseIsoDate(ctx.body.payment_received_on);
        if (paidOn === null) fields.add("payment_received_on", "Use a date like 2027-02-05");
        else if (paidOn > pacificDate(ctx.now)) fields.add("payment_received_on", "Payment date can't be after today (Pacific)");
        requireKey(key, fields);
        fields.throwIfAny();
        const figures = assess(order);
        await db.query(
          `INSERT INTO settlements (order_id, status, payment_received_on, payable_cents, commission_bps, commission_cents, shares)
           VALUES ($1, 'queued', $2, $3, $4, $5, $6)`,
          [order.id, paidOn, figures.payableCents, order.rule.commission_bps, figures.allocation.commissionCents, JSON.stringify(figures.shares)],
        );
        await audit(db, caller.id, "settle_requested", "order", order.id, { payment_received_on: paidOn });
        let status: "settled" | "queued" = "settled";
        await db.query("SAVEPOINT payment");
        try {
          await completeSettlement(
            db,
            { orderId: order.id, growerId: order.orchard.grower_id, balanceInvoiceId: order.balance_invoice_id, payableCents: figures.payableCents },
            caller.id,
          );
        } catch (error) {
          if (!isBillingOutage(error)) throw error;
          await db.query("ROLLBACK TO SAVEPOINT payment");
          status = "queued";
        }
        const after = await loadOrder(db, order.id);
        if (after === null) throw notFound();
        const reply: Reply = { status: status === "settled" ? 200 : 202, json: { status, settlement: settlementView(after) } };
        await remember(db, scope, key ?? "", ctx.body, reply);
        return reply;
      }),
  },
  {
    method: "GET",
    path: "/api/orders/:id/report",
    body: "none",
    auth: true,
    async handler({ user, params }) {
      const caller = user;
      const db = await pool.connect();
      try {
        const order = await loadOrder(db, params.id);
        const allowed =
          order !== null &&
          canSeeOrder(caller, order) &&
          (caller.role !== "beekeeper" || order.drops.some((drop) => drop.beekeeper.id === caller.id));
        if (!allowed || order.report_key === null) throw notFound();
        return fileRedirect(db, order.report_key, "application/pdf", "report.pdf");
      } finally {
        db.release();
      }
    },
  },
];
