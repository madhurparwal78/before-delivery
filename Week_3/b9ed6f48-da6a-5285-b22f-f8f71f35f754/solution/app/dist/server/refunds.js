// Refunds and session cancellation (brief: Business rules › Refunds). The cap is judged against
// the order's remaining amount under its row lock, and nothing is recorded until Kill Bill
// confirms the refund transaction.
import { randomUUID } from "node:crypto";
import { pool, rows, tx } from "./db.js";
import { assertValid, fail } from "./http.js";
import { recordAction } from "./audit.js";
import { refundPayment } from "./killbill.js";
import { deliverNow, queueMail } from "./mail.js";
import { receiptEmail } from "./receipts.js";
import { orderById, orderJson } from "./payments.js";
import { sessionById, sessionJson, sessionStatus } from "./sessions.js";
import { COPY, copyFor } from "../shared/copy.js";
import { formatPrice, minorToMajor } from "../shared/money.js";
import { lisbonDate } from "../shared/lisbon.js";
/** What may still be refunded on an order: its settled amount minus its refunds. */
const refundableMinor = (o) => o.amount_minor - o.refunded_minor;
/**
 * Refunds `requested` minor units (everything left when null) of an order inside `db`'s transaction:
 * locks the order, judges the cap, confirms the refund in Kill Bill, then records it.
 */
async function refundLocked(db, orderId, requested, reason, actorEmail, origin) {
    await db.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = (await orderById(db, orderId));
    const remaining = refundableMinor(order);
    if (remaining === 0)
        throw fail.conflict("fully_refunded", COPY.fullyRefunded);
    const amount = requested === null ? remaining : requested;
    const fields = {};
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1)
        fields.amount_minor = "Enter a whole number of minor units above zero.";
    else if (amount > remaining)
        fields.amount_minor = copyFor.refundCap(formatPrice(remaining, order.currency));
    if (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 500)
        fields.reason = COPY.reasonField;
    assertValid(fields);
    const refunded = amount;
    const id = randomUUID();
    const transaction = await refundPayment(order.killbill_payment_id, minorToMajor(refunded, order.currency), order.currency, `refund-${id}`);
    const at = new Date(transaction.effectiveDate);
    await db.query("INSERT INTO refunds (id, order_id, amount_minor, reason, at, killbill_transaction_id) VALUES ($1, $2, $3, $4, $5, $6)", [
        id,
        orderId,
        refunded,
        reason,
        at,
        transaction.transactionId,
    ]);
    if (refunded === remaining && order.kind === "ticket") {
        await db.query("UPDATE bookings SET state = 'refunded' WHERE order_id = $1 AND state = 'live'", [orderId]);
    }
    // A manager's refund is its own staff action with its own email; a cancellation records one
    // session_cancelled action and sends its own cancellation email instead.
    let mailId = null;
    if (origin === "manager_refund") {
        await recordAction(db, actorEmail, "refund", "order", orderId, { refund_id: id, amount_minor: refunded, currency: order.currency, reason });
        mailId = await queueMail(db, { email: order.user_email, name: order.user_name }, `Your refund — receipt ${order.receipt_number}`, receiptEmail({
            name: order.user_name,
            receiptNumber: order.receipt_number,
            description: `Refund: ${order.description}`,
            amountMinor: refunded,
            currency: order.currency,
            date: lisbonDate(at.getTime()),
            last4: order.card_last4,
        }));
    }
    return { refund: { id, amount_minor: refunded, reason: reason, at: at.toISOString() }, order: { ...order, refunded_minor: order.refunded_minor + refunded }, mailId };
}
export async function refundOrder(orderId, amountMinor, reason, actorEmail) {
    const outcome = await tx((db) => refundLocked(db, orderId, amountMinor, reason, actorEmail, "manager_refund"));
    if (outcome.mailId !== null)
        await deliverNow([outcome.mailId]);
    return { status: 201, body: { refund: outcome.refund, order: orderJson(outcome.order) } };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Cancels a session: refunds every live booking in full, one cancellation email per booking. */
export async function cancelSession(sessionId, requestedReason, actorEmail) {
    const reason = typeof requestedReason === "string" ? requestedReason.trim() : "";
    const session = await tx(async (db) => {
        const found = (await sessionById(db, sessionId, true));
        const status = sessionStatus(found, Date.now());
        if (found.cancelling || (status !== "on_sale" && status !== "closed"))
            throw fail.conflict("session_not_cancellable", COPY.notCancellable);
        if (reason.length < 3 || reason.length > 500)
            throw fail.validation({ reason: COPY.reasonField });
        await db.query("UPDATE guided_sessions SET cancelling = true WHERE id = $1", [sessionId]);
        return found;
    });
    try {
        // Bookings that committed their seats before the cancellation began are refunded by it.
        for (let waited = 0; waited < 120_000; waited += 200) {
            const pending = await rows(pool, "SELECT id FROM bookings WHERE session_id = $1 AND state = 'pending'", [sessionId]);
            if (!pending.length)
                break;
            await sleep(200);
        }
        const live = await rows(pool, "SELECT id, order_id FROM bookings WHERE session_id = $1 AND state = 'live' ORDER BY created_at", [sessionId]);
        const mailIds = [];
        for (const booking of live) {
            await tx(async (db) => {
                const outcome = await refundLocked(db, booking.order_id, null, reason, actorEmail, "session_cancellation");
                await db.query("UPDATE bookings SET state = 'cancelled' WHERE id = $1", [booking.id]);
                mailIds.push(await queueMail(db, { email: outcome.order.user_email, name: outcome.order.user_name }, `Cancelled: ${session.title} — full refund issued`, `${outcome.order.user_name}\nReceipt ${outcome.order.receipt_number}\n${session.title} has been cancelled.\nA full refund of ${formatPrice(outcome.refund.amount_minor, outcome.order.currency)} ${outcome.order.currency} has been issued to the card ending ${outcome.order.card_last4}.\n`));
            });
        }
        const cancelled = await tx(async (db) => {
            await db.query("UPDATE guided_sessions SET cancelled_at = now() WHERE id = $1", [sessionId]);
            await recordAction(db, actorEmail, "session_cancelled", "session", sessionId, { reason, refunds: live.length });
            return sessionById(db, sessionId);
        });
        await deliverNow(mailIds);
        return { status: 200, body: { session: sessionJson(cancelled ?? session, Date.now(), null), refunds: live.length } };
    }
    catch (error) {
        await pool.query("UPDATE guided_sessions SET cancelling = false WHERE id = $1 AND cancelled_at IS NULL", [sessionId]);
        throw error;
    }
}
