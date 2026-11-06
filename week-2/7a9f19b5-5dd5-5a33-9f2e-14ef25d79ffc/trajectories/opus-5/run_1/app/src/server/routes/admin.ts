/**
 * Admin actions: trade applications, dispatch, refunds, recorded payments,
 * clearance stock and service health. Every path here refuses a signed-in
 * non-admin before any record is looked up.
 */

import { query, queryOne, transaction } from "../db/pool.js";
import { LIMITS } from "../../shared/domain.js";
import { canDispatch, canRecordPayment, canRefund, refundableCents, statusAfterRefund } from "../../shared/orderState.js";
import { dueDateFor } from "../../shared/dates.js";
import { GST_INVOICE_ITEM_DESCRIPTION } from "../../shared/gst.js";
import type {
  AdminOrder,
  Order,
  ServiceHealth,
  StockItem,
  StockMovement,
  TradeApplication,
} from "../../shared/types.js";
import { readJson, sendJson, type Ctx } from "../http/context.js";
import {
  invalidState,
  notFound,
  paymentUnavailable,
  stockBelowZero,
  validation,
} from "../http/errors.js";
import { requireAdmin } from "../http/router.js";
import { FieldErrors, optionalInteger, optionalString, requiredInteger, requiredString } from "../http/validate.js";
import { effectiveStatus, loadOrderByKey, loadOrderIn, toOrderDto } from "../domain/orders.js";
import { serverToday } from "../domain/today.js";
import * as killbill from "../services/killbill.js";
import { sendTradeApproved, sendTradeDeclined } from "../services/mail.js";
import { ProviderUnavailable } from "../services/provider.js";
import { probeServices } from "../services/health.js";

const APPLICATION_SQL = `
  SELECT ta.id, u.name AS applicant_name, u.email AS applicant_email, ta.business_name, ta.nzbn,
         ta.occupation, ta.status, ta.submitted_at, ta.decided_at, ta.decline_reason
  FROM trade_applications ta JOIN users u ON u.id = ta.user_id
`;

interface ApplicationRow {
  id: string;
  applicant_name: string;
  applicant_email: string;
  business_name: string;
  nzbn: string;
  occupation: TradeApplication["occupation"];
  status: TradeApplication["status"];
  submitted_at: Date;
  decided_at: Date | null;
  decline_reason: string | null;
}

function toApplication(row: ApplicationRow): TradeApplication {
  return {
    id: row.id,
    applicant_name: row.applicant_name,
    applicant_email: row.applicant_email,
    business_name: row.business_name,
    nzbn: row.nzbn,
    occupation: row.occupation,
    status: row.status,
    submitted_at: row.submitted_at.toISOString(),
    decided_at: row.decided_at ? row.decided_at.toISOString() : null,
    decline_reason: row.decline_reason,
  };
}

export async function listApplications(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  const status = ctx.query.get("status");
  const rows = status
    ? await query<ApplicationRow>(`${APPLICATION_SQL} WHERE ta.status = $1 ORDER BY ta.submitted_at`, [status])
    : await query<ApplicationRow>(`${APPLICATION_SQL} ORDER BY ta.submitted_at`);
  sendJson(ctx.res, 200, { applications: rows.map(toApplication) });
}

/** Approving or declining is final: a decided application cannot be decided again. */
async function decide(
  ctx: Ctx,
  outcome: "approved" | "declined",
  reason: string | null,
): Promise<ApplicationRow> {
  const id = ctx.params.id ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();

  return transaction(async (client) => {
    const current = await client.query<{ status: TradeApplication["status"]; user_id: string }>(
      "SELECT status, user_id FROM trade_applications WHERE id = $1 FOR UPDATE",
      [id],
    );
    const application = current.rows[0];
    if (!application) throw notFound();
    if (application.status !== "submitted") throw invalidState(application.status);

    await client.query(
      "UPDATE trade_applications SET status = $2, decided_at = now(), decline_reason = $3 WHERE id = $1",
      [id, outcome, reason],
    );
    await client.query("UPDATE users SET trade_status = $2 WHERE id = $1", [application.user_id, outcome]);

    const updated = await client.query<ApplicationRow>(`${APPLICATION_SQL} WHERE ta.id = $1`, [id]);
    const row = updated.rows[0];
    if (!row) throw new Error("the trade application disappeared while it was being decided");
    return row;
  });
}

export async function approveApplication(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  const row = await decide(ctx, "approved", null);
  await sendTradeApproved({ to: row.applicant_email, name: row.applicant_name });
  sendJson(ctx.res, 200, { application: toApplication(row) });
}

export async function declineApplication(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  const body = readJson<{ reason?: unknown }>(ctx);
  const errors = new FieldErrors();
  const reason = requiredString(errors, "reason", body.reason, {
    min: LIMITS.declineReason.min,
    max: LIMITS.declineReason.max,
  });
  errors.throwIfAny();

  const row = await decide(ctx, "declined", reason);
  await sendTradeDeclined({ to: row.applicant_email, name: row.applicant_name, reason });
  sendJson(ctx.res, 200, { application: toApplication(row) });
}

export async function listOrders(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  const today = serverToday();
  const rows = await query<{ order_key: string; customer_email: string }>(
    `SELECT o.order_key, u.email AS customer_email FROM orders o JOIN users u ON u.id = o.user_id
     WHERE o.status NOT IN ('cart','declined','gateway_unavailable')
     ORDER BY o.created_at DESC`,
  );

  const orders: AdminOrder[] = [];
  for (const row of rows) {
    const loaded = await loadOrderByKey(row.order_key);
    if (loaded) orders.push({ ...toOrderDto(loaded, today), customer_email: row.customer_email });
  }
  sendJson(ctx.res, 200, { orders });
}

/**
 * Dispatch captures a card order's authorised amount, or raises the trade invoice
 * for an account order. Both are written only after Kill Bill's successful reply.
 */
export async function dispatch(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  const orderKey = ctx.params.orderKey ?? "";
  const loaded = await loadOrderByKey(orderKey);
  if (!loaded) throw notFound();

  const today = serverToday();
  const status = effectiveStatus(loaded.record, today);
  if (!canDispatch(status)) throw invalidState(status);

  const buyer = await queryOne<{ id: string; name: string }>("SELECT id, name FROM users WHERE id = $1", [
    loaded.record.user_id,
  ]);
  if (!buyer) throw notFound();

  try {
    if (status === "authorised") {
      const paymentId = loaded.record.kb_payment_id;
      if (!paymentId) throw new ProviderUnavailable("killbill");
      await killbill.capture({ paymentId, orderKey, totalCents: loaded.record.total_cents });
      await query("UPDATE orders SET status = 'captured', captured_cents = total_cents WHERE order_key = $1", [
        orderKey,
      ]);
    } else {
      const accountId = await killbill.ensureAccount({ userId: buyer.id, name: buyer.name });
      const items = loaded.lines.map((line) => ({
        description: `${line.variant_code} x ${line.quantity}`,
        amountCents: line.unit_price_cents * line.quantity,
      }));
      items.push({ description: GST_INVOICE_ITEM_DESCRIPTION, amountCents: loaded.record.gst_cents });
      const invoice = await killbill.createInvoice({ accountId, items });
      await query(
        `UPDATE orders SET status = 'invoiced', kb_invoice_id = $2, invoice_number = $3,
                           invoice_date = $4, due_date = $5
         WHERE order_key = $1`,
        [orderKey, invoice.kb_invoice_id, invoice.invoice_number, invoice.invoice_date, dueDateFor(invoice.invoice_date)],
      );
    }
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw paymentUnavailable();
    throw error;
  }

  sendJson(ctx.res, 200, { order: await reloadOrder(orderKey) });
}

async function reloadOrder(orderKey: string): Promise<Order> {
  const loaded = await loadOrderByKey(orderKey);
  if (!loaded) throw new Error(`order ${orderKey} disappeared while it was being read`);
  return toOrderDto(loaded, serverToday());
}

/**
 * Refunds are never more than the amount still refundable, and are written to the
 * order only after Kill Bill confirms the transaction. Simultaneous refunds on one
 * order are applied one at a time.
 */
export async function refund(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  const orderKey = ctx.params.orderKey ?? "";
  const body = readJson<{ amount_cents?: unknown; reason?: unknown }>(ctx);

  const errors = new FieldErrors();
  const amountCents = requiredInteger(errors, "amount_cents", body.amount_cents, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const reason = requiredString(errors, "reason", body.reason, {
    min: LIMITS.refundReason.min,
    max: LIMITS.refundReason.max,
  });
  errors.throwIfAny();

  // Claim the next refund sequence under a row lock, so competing refunds are
  // each checked against the amount left after the ones before them.
  const claim = await transaction(async (client) => {
    const loaded = await loadOrderIn(client, orderKey);
    if (!loaded) throw notFound();
    const status = effectiveStatus(loaded.record, serverToday());
    if (!canRefund(status)) throw invalidState(status);
    if (amountCents > refundableCents(loaded.record)) {
      throw validation({ amount_cents: "exceeds_refundable" });
    }
    const paymentId = loaded.record.kb_payment_id;
    if (!paymentId) throw new ProviderUnavailable("killbill");

    const seq = loaded.refunds.length + 1;
    return { paymentId, seq, capturedCents: loaded.record.captured_cents, refundedCents: loaded.record.refunded_cents };
  });

  let transactionId: string;
  try {
    const result = await killbill.refund({
      paymentId: claim.paymentId,
      orderKey,
      seq: claim.seq,
      amountCents,
    });
    transactionId = result.kb_transaction_id;
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw paymentUnavailable();
    throw error;
  }

  const recorded = await transaction(async (client) => {
    const loaded = await loadOrderIn(client, orderKey);
    if (!loaded) throw notFound();
    const inserted = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO refunds (order_id, seq, amount_cents, reason, kb_transaction_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [loaded.record.id, claim.seq, amountCents, reason, transactionId],
    );
    const refundedCents = loaded.record.refunded_cents + amountCents;
    await client.query("UPDATE orders SET refunded_cents = $2, status = $3 WHERE id = $1", [
      loaded.record.id,
      refundedCents,
      statusAfterRefund(loaded.record.captured_cents, refundedCents),
    ]);
    const row = inserted.rows[0];
    if (!row) throw new Error("the refund was not recorded");
    return row;
  });

  sendJson(ctx.res, 201, {
    refund: {
      id: recorded.id,
      amount_cents: amountCents,
      reason,
      kb_transaction_id: transactionId,
      created_at: recorded.created_at.toISOString(),
    },
    order: await reloadOrder(orderKey),
  });
}

/** Recording payment needs the full invoice total, including GST. */
export async function recordPayment(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  const orderKey = ctx.params.orderKey ?? "";
  const body = readJson<{ amount_cents?: unknown }>(ctx);

  const errors = new FieldErrors();
  const amountCents = requiredInteger(errors, "amount_cents", body.amount_cents, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  errors.throwIfAny();

  const loaded = await loadOrderByKey(orderKey);
  if (!loaded) throw notFound();
  const status = effectiveStatus(loaded.record, serverToday());
  if (!canRecordPayment(status)) throw invalidState(status);
  if (amountCents !== loaded.record.total_cents) throw validation({ amount_cents: "must_equal_balance" });

  const invoiceId = loaded.record.kb_invoice_id;
  const buyer = await queryOne<{ id: string; name: string }>("SELECT id, name FROM users WHERE id = $1", [
    loaded.record.user_id,
  ]);
  if (!invoiceId || !buyer) throw notFound();

  try {
    const accountId = await killbill.ensureAccount({ userId: buyer.id, name: buyer.name });
    await killbill.payInvoice({ accountId, invoiceId, orderKey, amountCents });
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw paymentUnavailable();
    throw error;
  }

  await query("UPDATE orders SET status = 'paid' WHERE order_key = $1", [orderKey]);
  sendJson(ctx.res, 200, { order: await reloadOrder(orderKey) });
}

const STOCK_SQL = `
  SELECT v.code AS variant_code, p.name AS product_name, v.retail_price_cents AS clearance_price_cents,
         COALESCE((SELECT SUM(m.delta) FROM stock_movements m WHERE m.variant_code = v.code), 0)::int
           AS stock_on_hand
  FROM variants v JOIN products p ON p.slug = v.product_slug
  WHERE v.clearance
  ORDER BY v.sort_order
`;

async function stockItems(): Promise<StockItem[]> {
  const rows = await query<Omit<StockItem, "movements">>(STOCK_SQL);
  const items: StockItem[] = [];
  for (const row of rows) {
    const movements = await query<{
      delta: number;
      reason: StockMovement["reason"];
      order_key: string | null;
      note: string | null;
      created_at: Date;
    }>(
      "SELECT delta, reason, order_key, note, created_at FROM stock_movements WHERE variant_code = $1 ORDER BY id",
      [row.variant_code],
    );
    items.push({
      ...row,
      movements: movements.map((movement) => ({
        delta: movement.delta,
        reason: movement.reason,
        order_key: movement.order_key,
        note: movement.note,
        created_at: movement.created_at.toISOString(),
      })),
    });
  }
  return items;
}

export async function listStock(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  sendJson(ctx.res, 200, { items: await stockItems() });
}

export async function adjustVariant(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  const code = ctx.params.code ?? "";
  const body = readJson<{ stock_adjust?: unknown; note?: unknown; clearance_price_cents?: unknown }>(ctx);

  const errors = new FieldErrors();
  const stockAdjust = optionalInteger(errors, "stock_adjust", body.stock_adjust, {
    min: -1_000_000,
    max: 1_000_000,
  });
  const note = optionalString(errors, "note", body.note, { max: 200 });
  const endsClearance = body.clearance_price_cents === null;
  const clearancePrice = endsClearance
    ? null
    : optionalInteger(errors, "clearance_price_cents", body.clearance_price_cents, { min: 1, max: 100_000_000 });
  errors.throwIfAny();

  await transaction(async (client) => {
    const variant = await client.query<{ code: string; clearance: boolean }>(
      "SELECT code, clearance FROM variants WHERE code = $1 FOR UPDATE",
      [code],
    );
    if (!variant.rows[0]) throw notFound();

    if (stockAdjust !== null && stockAdjust !== 0) {
      const onHand = await client.query<{ on_hand: number }>(
        "SELECT COALESCE(SUM(delta), 0)::int AS on_hand FROM stock_movements WHERE variant_code = $1",
        [code],
      );
      const current = onHand.rows[0]?.on_hand ?? 0;
      if (current + stockAdjust < 0) throw stockBelowZero();
      await client.query(
        "INSERT INTO stock_movements (variant_code, delta, reason, note) VALUES ($1,$2,'adjust',$3)",
        [code, stockAdjust, note],
      );
    }

    if (endsClearance) {
      await client.query("UPDATE variants SET clearance = FALSE WHERE code = $1", [code]);
    } else if (clearancePrice !== null) {
      await client.query(
        `UPDATE variants SET clearance = TRUE, retail_price_cents = $2, trade_price_cents = $2,
                             was_price_cents = COALESCE(was_price_cents, retail_price_cents)
         WHERE code = $1`,
        [code, clearancePrice],
      );
    }
  });

  const items = await stockItems();
  const item = items.find((candidate) => candidate.variant_code === code);
  sendJson(ctx.res, 200, { item: item ?? null });
}

export async function health(ctx: Ctx): Promise<void> {
  requireAdmin(ctx);
  const services: ServiceHealth = await probeServices();
  sendJson(ctx.res, 200, { services });
}
