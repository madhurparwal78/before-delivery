import { EDITION_PRICE, type BoxState, type PaymentState } from "../shared/domain.js";
import { alertCaptureFailed } from "./alerts.js";
import { pool, withTx } from "./db.js";
import { capture, GatewayUnreachable } from "./gateway.js";
import { fail } from "./http.js";
import { assertReachable, LedgerUnreachable } from "./killbill.js";
import { markPackedBankOrder, finishCapture } from "./payments.js";
import { serial } from "./locks.js";
import { requireOrder, setPaymentState, type OrderRow } from "./orders.js";
import { holdsAuthorisation } from "./transitions.js";
import { OUTAGE_COPY } from "../shared/copy.js";

/** Pack: capture the card (or settle nothing for a bank order) and move the box to packed. */

interface PackResult {
  status: 202;
  body: { reference: string; boxState: BoxState; paymentState: PaymentState; packing: "pending" | "done" };
}

const result = (order: OrderRow, packing: "pending" | "done"): PackResult => ({
  status: 202,
  body: { reference: order.reference, boxState: order.box_state ?? "claimed", paymentState: order.payment_state, packing },
});

const packBankOrder = async (order: OrderRow): Promise<PackResult> => {
  await withTx(async (tx) => {
    await markPackedBankOrder(tx, await requireOrder(tx, order.reference, true));
  });
  return result(await requireOrder(pool, order.reference), "done");
};

const requestCapture = async (order: OrderRow): Promise<PackResult> => {
  try {
    await assertReachable();
  } catch (error) {
    if (error instanceof LedgerUnreachable) return fail("ledger_unreachable", { message: OUTAGE_COPY.pack.ledger_unreachable });
    throw error;
  }
  const attempts = order.capture_attempts + 1;
  await pool.query("UPDATE orders SET capture_requested = true, capture_attempts = $2 WHERE reference = $1", [order.reference, attempts]);
  try {
    const reply = await capture(order.payment_id ?? "", EDITION_PRICE.totalOre, `capture-${order.reference}-${attempts}`);
    if (reply.status === 402 || reply.body.status === "capture_failed") {
      await withTx(async (tx) => {
        const locked = await requireOrder(tx, order.reference, true);
        await setPaymentState(tx, locked, "capture_failed");
        await tx.query("UPDATE orders SET capture_requested = false WHERE reference = $1", [order.reference]);
        await alertCaptureFailed(tx, `capfail-${order.reference}-${attempts}`, order.box_number, EDITION_PRICE.totalOre);
      });
      const failed = await requireOrder(pool, order.reference);
      return fail("capture_refused", {
        number: order.box_number, extra: { reference: failed.reference, boxState: failed.box_state, paymentState: failed.payment_state },
      });
    }
    if (reply.body.confirmation === "callback") return result(await requireOrder(pool, order.reference), "pending");
    await pool.query("UPDATE orders SET capture_confirmed = true WHERE reference = $1", [order.reference]);
    const done = await finishCapture(order.reference).catch(() => false);
    const fresh = await requireOrder(pool, order.reference);
    return result(fresh, done ? "done" : "pending");
  } catch (error) {
    if (error instanceof GatewayUnreachable) {
      await pool.query("UPDATE orders SET capture_requested = false WHERE reference = $1", [order.reference]);
      return fail("gateway_unreachable", { message: OUTAGE_COPY.pack.gateway_unreachable });
    }
    throw error;
  }
};

export const pack = (reference: string): Promise<PackResult> => serial(`pack:${reference}`, async () => {
  const order = await requireOrder(pool, reference);
  const lapsed = order.payment_state === "authorisation_expired" ||
    (holdsAuthorisation(order.payment_state) && order.auth_expires_at !== null && order.auth_expires_at.getTime() <= Date.now());
  if (lapsed) return fail("authorisation_expired");
  if (order.box_state !== "claimed") return fail("illegal_transition");
  if (order.method === "bank") return packBankOrder(order);
  if (order.capture_requested && !order.capture_confirmed && order.payment_state === "authorised") return result(order, "pending");
  return requestCapture(order);
});
