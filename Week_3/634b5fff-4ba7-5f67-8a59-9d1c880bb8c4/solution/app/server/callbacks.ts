import { EDITION_PRICE } from "../shared/domain.js";
import { alertCaptureFailed } from "./alerts.js";
import { businessNow } from "./clock.js";
import { pool, withTx } from "./db.js";
import { refundTransfer, returnTransfer } from "./gateway.js";
import { enqueue } from "./jobs.js";
import { claimAuthorised, finishCapture, finishSettlement, lapseTransfer } from "./payments.js";
import { loadOrder, requireOrder, setPaymentState, type OrderRow } from "./orders.js";
import { confirmRefund, refundForGatewayEvent } from "./refunds.js";
import { moveBox } from "./boxes.js";
import { awaitsAuthorisation, holdsAuthorisation } from "./transitions.js";
import { fail } from "./http.js";

/** Signed gateway callbacks: deduplicated by event id, ordered by sequence, applied only when they move forward. */

const TYPES = ["payment.authorised", "payment.declined", "payment.captured", "payment.capture_failed", "payment.voided", "payment.refunded", "transfer.received"] as const;

interface CallbackEvent {
  eventId: string;
  sequence: number;
  type: (typeof TYPES)[number];
  paymentId: string | null;
  transferId: string | null;
  reference: string;
  refundId: string | null;
  amountOre: number;
  declineCode: string | null;
}

type CallbackOutcome = "applied" | "duplicate" | "ignored" | "waiting";

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export const parseCallback = (raw: unknown): CallbackEvent => {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const { eventId, reference, sequence, amountOre } = body;
  if (typeof eventId !== "string" || typeof reference !== "string" || !TYPES.some((type) => type === body.type) ||
      typeof sequence !== "number" || !Number.isInteger(sequence) || typeof amountOre !== "number" || !Number.isInteger(amountOre)) {
    return fail("validation_failed");
  }
  return {
    eventId, reference, sequence, amountOre, type: body.type as CallbackEvent["type"], paymentId: text(body.paymentId),
    transferId: text(body.transferId), refundId: text(body.refundId), declineCode: text(body.declineCode),
  };
};

const record = async (event: CallbackEvent, status: CallbackOutcome): Promise<void> => {
  await pool.query("UPDATE payment_events SET status = $2 WHERE event_id = $1", [event.eventId, status]);
};

const onTransfer = async (order: OrderRow, event: CallbackEvent): Promise<CallbackOutcome> => {
  if (order.method !== "bank" || !order.transfer_id) return "ignored";
  if (order.payment_state === "pending" && order.deadline_at && order.deadline_at.getTime() <= businessNow().getTime()) {
    await lapseTransfer(order.reference);
  }
  const current = await requireOrder(pool, order.reference);
  if (current.payment_state === "lapsed") {
    await refundTransfer(order.transfer_id, event.amountOre, `late-${event.eventId}`);
    await enqueue(pool, "mail", `refund-mail-late-${event.eventId}`, { template: "refund", reference: order.reference, refundOre: event.amountOre });
    return "applied";
  }
  if (current.payment_state !== "pending") return "ignored";
  if (event.amountOre !== EDITION_PRICE.totalOre) {
    await returnTransfer(order.transfer_id, event.amountOre, `return-${event.eventId}`);
    await enqueue(pool, "mail", `refund-mail-wrong-${event.eventId}`, { template: "refund", reference: order.reference, refundOre: event.amountOre });
    return "applied";
  }
  await pool.query("UPDATE orders SET settle_confirmed = true WHERE reference = $1", [order.reference]);
  await finishSettlement(order.reference).catch(() => false);
  return "applied";
};

const onRefund = async (order: OrderRow, event: CallbackEvent): Promise<CallbackOutcome> => {
  if (holdsAuthorisation(order.payment_state)) return "waiting";
  if (order.payment_state !== "captured" && order.payment_state !== "partially_refunded" && order.payment_state !== "settled") return "ignored";
  const refundId = await refundForGatewayEvent(order.reference, event.refundId, event.amountOre);
  if (!refundId) return "ignored";
  await confirmRefund(refundId).catch(() => false);
  return "applied";
};

const apply = async (order: OrderRow, event: CallbackEvent): Promise<CallbackOutcome> => {
  switch (event.type) {
    case "payment.authorised": {
      if (!awaitsAuthorisation(order.payment_state)) return "ignored";
      if (event.paymentId && !order.payment_id) await pool.query("UPDATE orders SET payment_id = $2 WHERE reference = $1", [order.reference, event.paymentId]);
      await claimAuthorised(order.reference);
      return "applied";
    }
    case "payment.declined": {
      if (!awaitsAuthorisation(order.payment_state)) return "ignored";
      await setPaymentState(pool, order, "declined");
      return "applied";
    }
    case "payment.captured": {
      if (!holdsAuthorisation(order.payment_state)) return "ignored";
      await pool.query("UPDATE orders SET capture_confirmed = true WHERE reference = $1", [order.reference]);
      await finishCapture(order.reference).catch(() => false);
      return "applied";
    }
    case "payment.capture_failed": {
      if (order.payment_state !== "authorised") return "ignored";
      await withTx(async (tx) => {
        await setPaymentState(tx, order, "capture_failed");
        await tx.query("UPDATE orders SET capture_requested = false WHERE reference = $1", [order.reference]);
        await alertCaptureFailed(tx, `capfail-${event.eventId}`, order.box_number, EDITION_PRICE.totalOre);
      });
      return "applied";
    }
    case "payment.voided": {
      if (order.payment_state !== "authorised") return "ignored";
      await withTx(async (tx) => {
        await setPaymentState(tx, order, "voided");
        await moveBox(tx, order.box_number, "available");
        await tx.query("UPDATE orders SET kb_closed = false WHERE reference = $1", [order.reference]);
      });
      return "applied";
    }
    case "payment.refunded":
      return onRefund(order, event);
    case "transfer.received":
      return onTransfer(order, event);
  }
};

export const handleCallback = async (event: CallbackEvent): Promise<CallbackOutcome> => {
  const order = await loadOrder(pool, event.reference);
  if (!order) return fail("not_found");
  const inserted = await pool.query(
    "INSERT INTO payment_events (event_id, reference, sequence, type, status, payload) VALUES ($1, $2, $3, $4, 'received', $5) ON CONFLICT DO NOTHING",
    [event.eventId, event.reference, event.sequence, event.type, event],
  );
  if (inserted.rowCount === 0) return "duplicate";
  const fresh = await requireOrder(pool, event.reference);
  if (event.sequence < fresh.last_sequence) {
    await record(event, "ignored");
    return "ignored";
  }
  let outcome: CallbackOutcome;
  try {
    outcome = await apply(fresh, event);
  } catch (error) {
    await pool.query("DELETE FROM payment_events WHERE event_id = $1", [event.eventId]);
    throw error;
  }
  await record(event, outcome);
  if (outcome === "applied") await pool.query("UPDATE orders SET last_sequence = GREATEST(last_sequence, $2) WHERE reference = $1", [event.reference, event.sequence]);
  return outcome;
};
