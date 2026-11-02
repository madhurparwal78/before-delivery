import { randomUUID } from "node:crypto";
import { allow, currentUser, FULFILMENT_TEAM, REFUND_ROLES, signedIn, TRANSITION_ROLES, type Ctx, type Reply } from "../context.js";
import { query, rows, tx } from "../db.js";
import { slipKey } from "../documents.js";
import { abandonAttempt, beginAttempt, finishAttempt, fingerprint } from "../domain/idempotency.js";
import { money } from "../../shared/format.js";
import {
  assertTransition,
  loadOrders,
  orderJson,
  QUEUE_STATUSES,
  refundableParts,
  refundFigures,
  refundJson,
  type FullOrder,
  type OrderStatus,
  type RefundRow,
} from "../domain/orders.js";
import { splitRefund } from "../domain/refunds.js";
import { stockFigures } from "../domain/stock.js";
import { derive, subscriptionJson, type SubscriptionRow } from "../domain/subscriptions.js";
import { receiptCopy } from "../emails.js";
import { getObject } from "../files.js";
import { serviceStatus } from "../health.js";
import { ApiError, billingUnavailable, errorBody, int, notFound, str, validation } from "../http.js";
import { refundPayment, KillBillError } from "../killbill.js";

export async function status(ctx: Ctx): Promise<Reply> {
  const user = await currentUser(ctx.req).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "store_unavailable") return "store_down" as const;
    throw error;
  });
  if (user !== "store_down") {
    if (!user) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
    allow(user, FULFILMENT_TEAM);
  }
  return { status: 200, body: { services: serviceStatus() } };
}

async function staffOrder(ctx: Ctx, roles = FULFILMENT_TEAM): Promise<FullOrder> {
  const user = await signedIn(ctx);
  const [full] = await loadOrders([ctx.params[0].toUpperCase()]);
  if (!full || full.order.status === "pending_payment") throw notFound();
  allow(user, roles);
  return full;
}

export async function queue(ctx: Ctx): Promise<Reply> {
  allow(await signedIn(ctx), FULFILMENT_TEAM);
  const numbers = await query<{ number: string }>(
    "SELECT number FROM orders WHERE status = ANY($1) ORDER BY paid_at, number",
    [QUEUE_STATUSES],
  );
  return { status: 200, body: { orders: (await loadOrders(numbers.map((n) => n.number))).map(orderJson) } };
}

const MOVES: OrderStatus[] = ["picking", "packed", "shipped"];

export async function transition(ctx: Ctx): Promise<Reply> {
  const full = await staffOrder(ctx, TRANSITION_ROLES);
  const to = str(ctx.body, "to") as OrderStatus | undefined;
  if (!to || !MOVES.includes(to)) throw validation({ to: "Move to picking, packed or shipped." });
  await tx(async (client) => {
    const [locked] = await rows<{ status: OrderStatus }>(client, "SELECT status FROM orders WHERE number = $1 FOR UPDATE", [
      full.order.number,
    ]);
    assertTransition(full.order.number, locked.status, to);
    await rows(client, "UPDATE orders SET status = $2 WHERE number = $1", [full.order.number, to]);
  });
  const [after] = await loadOrders([full.order.number]);
  return { status: 200, body: { order: orderJson(after) } };
}

export async function staffOrderDetail(ctx: Ctx): Promise<Reply> {
  const full = await staffOrder(ctx);
  return { status: 200, body: { order: orderJson(full), customer: { name: full.order.customer_name, email: full.order.email } } };
}

export async function packingSlip(ctx: Ctx): Promise<Reply> {
  const full = await staffOrder(ctx);
  const file = await getObject(slipKey(full.order.number));
  return { status: 200, file: { data: file.body, type: "application/pdf", name: `packing-slip-${full.order.number}.pdf` } };
}

export async function stock(ctx: Ctx): Promise<Reply> {
  allow(await signedIn(ctx), FULFILMENT_TEAM);
  return { status: 200, body: { flavours: await stockFigures() } };
}

export async function search(ctx: Ctx): Promise<Reply> {
  allow(await signedIn(ctx), FULFILMENT_TEAM);
  const q = (ctx.url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return { status: 200, body: { orders: [], subscriptions: [] } };
  const numbers = await query<{ number: string }>(
    `SELECT number FROM orders WHERE status <> 'pending_payment' AND (lower(number) = $1 OR lower(email) = $1)
     ORDER BY placed_at DESC`,
    [q],
  );
  const subs = await query<SubscriptionRow>("SELECT * FROM subscriptions WHERE lower(email) = $1 ORDER BY created_at DESC", [q]);
  const subscriptions = [];
  for (const row of subs) subscriptions.push(await subscriptionJson(row, await derive(row)));
  return { status: 200, body: { orders: (await loadOrders(numbers.map((n) => n.number))).map(orderJson), subscriptions } };
}

// ---- refunds ------------------------------------------------------------------------------

export async function refund(ctx: Ctx): Promise<Reply> {
  const user = await signedIn(ctx);
  const full = await staffOrder(ctx, REFUND_ROLES);
  const key = ctx.req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8 || key.length > 128) {
    throw validation({ idempotency_key: "Send an Idempotency-Key header of 8 to 128 characters." });
  }
  const scope = `refund:${user.id}`;
  const attempt = await beginAttempt(scope, key, fingerprint("POST", `/api/staff/orders/${full.order.number}/refunds`, ctx.body));
  if (attempt.kind === "replay") return { status: attempt.status, body: attempt.body };
  try {
    const reply = await issueRefund(ctx, full.order.number);
    await finishAttempt(scope, key, reply.status, reply.body);
    return reply;
  } catch (error) {
    if (error instanceof ApiError && [409, 422].includes(error.status)) {
      const body = errorBody(error);
      await finishAttempt(scope, key, error.status, body);
      return { status: error.status, body };
    }
    await abandonAttempt(scope, key);
    if (error instanceof ApiError && error.code === "billing_unavailable") throw billingUnavailable("Billing is unreachable. No refund was made.");
    throw error;
  }
}

async function issueRefund(ctx: Ctx, number: string): Promise<Reply> {
  const amount = int(ctx.body, "amount_cents");
  const reason = str(ctx.body, "reason")?.trim() ?? "";
  const created = await tx(async (client) => {
    await rows(client, "SELECT number FROM orders WHERE number = $1 FOR UPDATE", [number]);
    const [locked] = await loadOrders([number], client);
    const { refundable } = refundFigures(locked);
    if (refundable <= 0) throw new ApiError(409, "not_refundable", "Nothing is left to refund on this order.");
    const fields: Record<string, string> = {};
    if (amount === undefined || amount < 1) fields.amount_cents = "Enter an amount of at least $0.01.";
    else if (amount > refundable) fields.amount_cents = `Only ${money(refundable)} is left to refund on this order.`;
    if (reason.length < 1 || reason.length > 500) fields.reason = "Give a reason (up to 500 characters).";
    if (amount === undefined || Object.keys(fields).length > 0) throw validation(fields);
    const earlier = locked.refunds.filter((r) => r.status !== "rejected").map((r) => r.split);
    const split = splitRefund(refundableParts(locked), earlier, amount);
    const [row] = await rows<RefundRow>(
      client,
      `INSERT INTO refunds (id, order_number, status, amount_cents, reason, full_refund, split)
       VALUES ($1, $2, 'pending_provider', $3, $4, $5, $6) RETURNING *`,
      [randomUUID(), number, amount, reason, amount === refundable, JSON.stringify(split)],
    );
    return { row, paymentId: locked.order.kb_payment_id ?? "" };
  });
  try {
    await refundPayment(created.paymentId, created.row.amount_cents, created.row.id);
  } catch (error) {
    if (!(error instanceof KillBillError)) {
      await query("DELETE FROM refunds WHERE id = $1", [created.row.id]);
      throw error;
    }
    await query("UPDATE refunds SET status = 'rejected', decided_at = now() WHERE id = $1", [created.row.id]);
  }
  const [after] = await loadOrders([number]);
  const shown = after.refunds.find((r) => r.id === created.row.id) ?? created.row;
  return { status: 202, body: { refund: refundJson(shown), order: orderJson(after) } };
}

export async function resendReceipt(ctx: Ctx): Promise<Reply> {
  const full = await staffOrder(ctx, REFUND_ROLES);
  await receiptCopy(full);
  return { status: 202, body: { queued: true } };
}
