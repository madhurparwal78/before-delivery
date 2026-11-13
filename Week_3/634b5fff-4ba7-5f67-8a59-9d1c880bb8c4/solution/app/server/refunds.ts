import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { EDITION_PRICE } from "../shared/domain.js";
import { splitRefund, type Remainders, type SplitParts } from "../shared/money.js";
import { moveBox } from "./boxes.js";
import { businessNow } from "./clock.js";
import { pool, withTx, type Queryable } from "./db.js";
import { OUTAGE_COPY } from "../shared/copy.js";
import { GatewayUnreachable, refundPayment, refundTransfer } from "./gateway.js";
import { fail } from "./http.js";
import { assertReachable, LedgerUnreachable } from "./killbill.js";
import { isRefundableState } from "./transitions.js";
import { enqueue } from "./jobs.js";
import { recordRefund } from "./ledger.js";
import { serial } from "./locks.js";
import { orderRate, requireOrder, saleParts, setPaymentState, type OrderRow } from "./orders.js";

export interface RefundRow {
  refund_id: string;
  reference: string;
  idempotency_key: string | null;
  amount_ore: number;
  net_ore: number;
  vat_ore: number;
  charity_ore: number;
  maker_ore: number;
  state: "pending" | "settled";
  gateway_refund_id: string | null;
  gateway_confirmed: boolean;
  kb_done: boolean;
  rate_basis_points: number;
  settled_at: Date | null;
}

export const refundsOf = async (q: Queryable, reference: string): Promise<RefundRow[]> =>
  (await q.query("SELECT * FROM refunds WHERE reference = $1 ORDER BY created_at, refund_id", [reference])).rows as RefundRow[];

/** What remains of the box after every refund, pending ones included. */
const remainders = async (q: Queryable, order: OrderRow): Promise<Remainders> => {
  const sale = saleParts(await orderRate(q, order));
  const taken = (await refundsOf(q, order.reference)).reduce(
    (sum, refund) => ({
      grossOre: sum.grossOre + refund.amount_ore, netOre: sum.netOre + refund.net_ore, vatOre: sum.vatOre + refund.vat_ore,
      charityOre: sum.charityOre + refund.charity_ore, makerOre: sum.makerOre + refund.maker_ore,
    }),
    { grossOre: 0, netOre: 0, vatOre: 0, charityOre: 0, makerOre: 0 },
  );
  return {
    grossOre: EDITION_PRICE.priceOre - taken.grossOre, netOre: sale.netOre - taken.netOre, vatOre: sale.vatOre - taken.vatOre,
    charityOre: sale.charityOre - taken.charityOre, makerOre: sale.makerOre - taken.makerOre,
  };
};

const checkRefundAmount = async (q: Queryable, order: OrderRow, amountOre: number): Promise<SplitParts> => {
  if (!Number.isInteger(amountOre) || amountOre <= 0) return fail("refund_invalid");
  const left = await remainders(q, order);
  if (amountOre > left.grossOre) return fail("refund_exceeds_remainder");
  return splitRefund(amountOre, left, await orderRate(q, order));
};

/** Reserves the amount against the remainder under the order's row lock; concurrent refunds cannot exceed it. */
const reserveRefund = async (
  reference: string, amountOre: number, key: string | null, gatewayRefundId: string | null,
): Promise<RefundRow> =>
  withTx(async (tx) => {
    const order = await requireOrder(tx, reference, true);
    const parts = await checkRefundAmount(tx, order, amountOre);
    const refundId = gatewayRefundId ?? `ref_${randomUUID()}`;
    const inserted = await tx.query(
      `INSERT INTO refunds (refund_id, reference, idempotency_key, amount_ore, net_ore, vat_ore, charity_ore, maker_ore,
         gateway_refund_id, rate_basis_points)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [refundId, reference, key, amountOre, parts.netOre, parts.vatOre, parts.charityOre, parts.makerOre, gatewayRefundId, await orderRate(tx, order)],
    );
    return inserted.rows[0] as RefundRow;
  });

const dropRefund = async (refundId: string): Promise<void> => {
  await pool.query("DELETE FROM refunds WHERE refund_id = $1 AND state = 'pending'", [refundId]);
};

const settle = async (tx: PoolClient, order: OrderRow, refund: RefundRow): Promise<void> => {
  const settledBefore = (await tx.query("SELECT coalesce(sum(amount_ore), 0)::int AS gross FROM refunds WHERE reference = $1 AND state = 'settled'", [order.reference])).rows[0].gross as number;
  const finalRefund = settledBefore + refund.amount_ore === EDITION_PRICE.priceOre;
  const now = businessNow();
  await tx.query("UPDATE refunds SET state = 'settled', kb_done = true, settled_at = $2 WHERE refund_id = $1", [refund.refund_id, now]);
  await tx.query(
    `INSERT INTO split_lines (reference, box_number, kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, rate_basis_points, posted_at, refund_id)
     VALUES ($1, $2, 'refund', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [order.reference, order.box_number, -refund.amount_ore, -refund.net_ore, -refund.vat_ore, -refund.charity_ore, -refund.maker_ore, refund.rate_basis_points, now, refund.refund_id],
  );
  await setPaymentState(tx, order, finalRefund ? "refunded" : "partially_refunded");
  if (finalRefund) {
    await moveBox(tx, order.box_number, "returned");
    await tx.query("UPDATE orders SET certificate_state = 'cancelled' WHERE reference = $1", [order.reference]);
  }
  await enqueue(tx, "mail", `refund-mail-${refund.refund_id}`, { template: "refund", reference: order.reference, refundOre: refund.amount_ore });
  await enqueue(tx, "webhook", `refund-hook-${refund.refund_id}`, { refundId: refund.refund_id });
};

/** Settles a refund once the gateway has confirmed it and Kill Bill has the refund; returns whether it settled. */
export const finishRefund = (refundId: string): Promise<boolean> => serial(`refund:${refundId}`, async () => {
  const found = await pool.query("SELECT * FROM refunds WHERE refund_id = $1", [refundId]);
  const refund = found.rows[0] as RefundRow | undefined;
  if (!refund || refund.state === "settled" || !refund.gateway_confirmed) return refund?.state === "settled";
  const order = await requireOrder(pool, refund.reference);
  await recordRefund(order, refund);
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, refund.reference, true);
    const current = await tx.query("SELECT state FROM refunds WHERE refund_id = $1 FOR UPDATE", [refundId]);
    if (current.rows[0].state === "pending") await settle(tx, locked, refund);
  });
  return true;
});

export const confirmRefund = async (refundId: string): Promise<boolean> => {
  await pool.query("UPDATE refunds SET gateway_confirmed = true WHERE refund_id = $1", [refundId]);
  return finishRefund(refundId);
};

/** The refund a gateway `payment.refunded` event is about: ours when its id is known, else one started at the gateway. */
export const refundForGatewayEvent = async (reference: string, gatewayRefundId: string | null, amountOre: number): Promise<string | null> => {
  const known = gatewayRefundId
    ? (await pool.query("SELECT refund_id FROM refunds WHERE gateway_refund_id = $1 OR refund_id = $1", [gatewayRefundId])).rows[0]
    : null;
  if (known) return known.refund_id as string;
  return (await reserveRefund(reference, amountOre, null, gatewayRefundId).catch(() => null))?.refund_id ?? null;
};

/** Refunds the sale was waiting on when its capture landed: applied now in order of arrival. */
export const applyWaitingRefunds = async (reference: string): Promise<void> => {
  const waiting = await pool.query("SELECT event_id, payload FROM payment_events WHERE reference = $1 AND status = 'waiting' ORDER BY sequence", [reference]);
  for (const row of waiting.rows as { event_id: string; payload: { refundId: string | null; amountOre: number } }[]) {
    const refundId = await refundForGatewayEvent(reference, row.payload.refundId, row.payload.amountOre);
    await pool.query("UPDATE payment_events SET status = 'applied' WHERE event_id = $1", [row.event_id]);
    if (refundId) await confirmRefund(refundId);
  }
};

interface RefundOutcome {
  status: number;
  body: Record<string, unknown>;
}

const refundBody = (refund: RefundRow): Record<string, unknown> => ({
  refundId: refund.refund_id, reference: refund.reference, state: refund.state, amountOre: refund.amount_ore,
  netOre: refund.net_ore, vatOre: refund.vat_ore, charityOre: refund.charity_ore, makerOre: refund.maker_ore,
});

/** The treasurer's refund: reserve against the remainder, ask the gateway, settle when it and Kill Bill both confirm. */
export const startStaffRefund = async (reference: string, amountOre: number, key: string): Promise<RefundOutcome> => {
  const order = await requireOrder(pool, reference);
  if (!isRefundableState(order.payment_state)) return fail("not_captured");
  await checkRefundAmount(pool, order, amountOre);
  try {
    await assertReachable();
  } catch (error) {
    if (error instanceof LedgerUnreachable) return fail("ledger_unreachable", { message: OUTAGE_COPY.refund.ledger_unreachable });
    throw error;
  }
  const refund = await reserveRefund(reference, amountOre, key, null);
  try {
    const reply = order.method === "bank"
      ? await refundTransfer(order.transfer_id ?? "", amountOre, key)
      : await refundPayment(order.payment_id ?? "", amountOre, key);
    if (typeof reply.body.refundId === "string") {
      await pool.query("UPDATE refunds SET gateway_refund_id = $2 WHERE refund_id = $1", [refund.refund_id, reply.body.refundId]);
    }
    if (reply.body.confirmation !== "callback") await confirmRefund(refund.refund_id).catch(() => false);
  } catch (error) {
    await dropRefund(refund.refund_id);
    if (error instanceof GatewayUnreachable) return fail("gateway_unreachable", { message: OUTAGE_COPY.refund.gateway_unreachable });
    throw error;
  }
  const settled = (await pool.query("SELECT * FROM refunds WHERE refund_id = $1", [refund.refund_id])).rows[0] as RefundRow;
  return { status: 202, body: refundBody(settled) };
};
