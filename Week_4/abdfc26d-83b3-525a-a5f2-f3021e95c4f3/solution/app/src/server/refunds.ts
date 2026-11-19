import { randomUUID } from "node:crypto";
import { dollars, vatCents } from "../shared/rules.js";
import { requireRole, signedIn } from "./auth.js";
import { config } from "./config.js";
import { one, pool, rows, tx, type Db } from "./db.js";
import { conflict, during, invalidTransition, notFound, paymentsUnavailable, validationFailed } from "./errors.js";
import { json, type Ctx, type Route } from "./http.js";
import { idempotent } from "./idempotency.js";
import { renderCreditNote } from "./invoices.js";
import * as killbill from "./killbill.js";
import { canMove, MOVES } from "./order-states.js";
import { orderById, ORDER_SELECT, orderView, type OrderRow } from "./orders.js";
import { nextNumber } from "./sequences.js";
import { refundSplit, type Party, type Share } from "./splits.js";

const PLATFORM_HOLDER = "Brightmoss Works";

interface SplitRow {
  party: Party;
  holder_id: string | null;
  holder: string | null;
  kind: "sale" | "refund";
  amount_cents: number;
  refund_id: string | null;
}

async function splitRows(db: Db, orderId: string): Promise<SplitRow[]> {
  return rows<SplitRow>(
    db,
    `SELECT s.party, s.holder_id, u.display_name AS holder, s.kind, s.amount_cents, s.refund_id
       FROM split_rows s LEFT JOIN users u ON u.id = s.holder_id WHERE s.order_id = $1
      ORDER BY s.id`,
    [orderId],
  );
}

const rowView = (r: SplitRow) => ({
  party: r.party,
  holder: r.holder ?? PLATFORM_HOLDER,
  kind: r.kind,
  amount_cents: r.amount_cents,
  refund_id: r.refund_id,
});

async function founder(ctx: Ctx) {
  const user = await signedIn(ctx);
  requireRole(user, "founder-operator");
  return user;
}

async function listOrders(ctx: Ctx) {
  await founder(ctx);
  const state = ctx.query.get("state");
  const list = await rows<OrderRow>(
    pool,
    `SELECT * FROM (${ORDER_SELECT}) q ${state ? "WHERE q.state = $1" : "WHERE q.state <> 'expired'"} ORDER BY q.created_at DESC LIMIT 500`,
    state ? [state] : [],
  );
  return json(200, { orders: list.map(orderView) });
}

async function splits(ctx: Ctx) {
  const user = await signedIn(ctx);
  const order = await orderById(pool, ctx.params.id ?? "");
  if (!order) throw notFound();
  requireRole(user, "founder-operator");
  return json(200, { net_cents: order.net_cents, rows: (await splitRows(pool, order.id)).map(rowView) });
}

async function refund(ctx: Ctx) {
  const user = await signedIn(ctx);
  const order = await orderById(pool, ctx.params.id ?? "");
  if (!order) throw notFound();
  requireRole(user, "founder-operator");
  return idempotent(ctx, user, async () => {
    const result = await tx(async (client) => {
      const locked = (await one<OrderRow>(client, `${ORDER_SELECT} WHERE o.id = $1 FOR UPDATE OF o`, [order.id])) as OrderRow;
      if (!canMove("refundInFull", locked.state)) throw invalidTransition("Only a receipted order can be refunded.");
      const paidAt = locked.paid_at as Date;
      const age = (Date.now() - paidAt.getTime()) / 1000;
      if (age > config.refundWindowSeconds) throw conflict("refund_window_closed", "Refunds close 30 days after payment.");
      const remaining = locked.net_cents - locked.refunded_net_cents;
      const body = ctx.body !== null && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {};
      const net = body.net_cents;
      const reason = body.reason ?? "";
      const fields: Record<string, string> = {};
      if (!Number.isInteger(net) || (net as number) < 1 || (net as number) > remaining) {
        fields.net_cents = `Refund between $0.01 and $${dollars(remaining)}.`;
      }
      if (typeof reason !== "string" || reason.length > 300) fields.reason = "Keep the reason under 300 characters.";
      if (Object.keys(fields).length) throw validationFailed(fields);
      const amount = net as number;
      const final = amount === remaining;
      const vat = final ? locked.vat_cents - locked.refunded_vat_cents : vatCents(amount, locked.vat_rate_percent);
      const id = randomUUID();
      if (!locked.kb_payment_id) throw invalidTransition("This order was not paid through Kill Bill, so it cannot be refunded here.");
      const refunded = await during("killbill", paymentsUnavailable, () => killbill.refund(locked.kb_payment_id as string, id, amount + vat));
      if (!refunded) throw paymentsUnavailable();
      const existing = await splitRows(client, locked.id);
      const sale: Share[] = existing.filter((r) => r.kind === "sale").map((r) => ({ party: r.party, holderId: r.holder_id, amount: r.amount_cents }));
      const kept = new Map<Party, number>();
      for (const r of existing) kept.set(r.party, (kept.get(r.party) ?? 0) + r.amount_cents);
      const reversal = refundSplit(amount, locked.net_cents, sale, kept, final);
      const now = (await one<{ now: Date }>(client, "SELECT now() AS now"))?.now as Date;
      const number = await nextNumber(client, "credit_note", now.getUTCFullYear());
      await client.query(
        `INSERT INTO refunds (id, order_id, credit_note_number, net_cents, vat_cents, gross_cents, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, locked.id, number, amount, vat, amount + vat, reason, now],
      );
      for (const share of reversal) {
        await client.query(
          "INSERT INTO split_rows (order_id, party, holder_id, kind, amount_cents, refund_id, at) VALUES ($1, $2, $3, 'refund', $4, $5, $6)",
          [locked.id, share.party, share.holderId, -share.amount, id, now],
        );
      }
      await client.query(
        `UPDATE orders SET refunded_net_cents = refunded_net_cents + $2, refunded_vat_cents = refunded_vat_cents + $3,
                state = CASE WHEN $4 THEN $5 ELSE state END WHERE id = $1`,
        [locked.id, amount, vat, final, MOVES.refundInFull.to],
      );
      const rowsOut = (await splitRows(client, locked.id)).filter((r) => r.refund_id === id).map(rowView);
      return { id, credit_note_number: number, net_cents: amount, vat_cents: vat, gross_cents: amount + vat, rows: rowsOut };
    });
    void renderCreditNote(result.id);
    return json(201, { refund: result });
  });
}

export const adminOrderRoutes: Route[] = [
  { method: "GET", pattern: "/api/admin/orders", handler: listOrders },
  { method: "GET", pattern: "/api/admin/orders/{id}/splits", handler: splits },
  { method: "POST", pattern: "/api/admin/orders/{id}/refunds", handler: refund },
];
