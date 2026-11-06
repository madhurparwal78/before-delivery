// Payments on the in-app gateway: authorise, capture, void and refund, each a state change with one audit entry,
// and the deposit outcomes of a booking's events, decided here and nowhere else (brief: Business rules, Payment
// states; Deposits; Test cards). Kill Bill work for a payment is queued in billing_ops and run in order.
import { randomUUID } from "node:crypto";
import { audit } from "./audit.js";
import { runPaymentOps } from "./billing.js";
import { now, plusSeconds } from "./clock.js";
import { config } from "./config.js";
import { afterCommit, currentContext } from "./context.js";
import { first } from "./db.js";
import { authorise, cardLast4 } from "./domain/gateway.js";
import { checkPaymentAction, refundableCents, statusAfterRefund } from "./domain/payments.js";
import { conflict } from "./errors.js";
export const PAYMENT_SELECT = `
  SELECT p.*,
         (SELECT count(*)::int FROM billing_ops o WHERE o.payment_id = p.id AND o.done_at IS NULL) AS open_ops,
         (SELECT count(*)::int FROM billing_ops o WHERE o.payment_id = p.id) AS ops
    FROM payments p`;
export async function lockPayment(client, id) {
    await client.query(`SELECT 1 FROM payments WHERE id = $1 FOR UPDATE`, [id]);
    return first((await client.query(`${PAYMENT_SELECT} WHERE p.id = $1`, [id])).rows);
}
/** not_recorded until Kill Bill work exists for the payment, pending while any of it is open, then recorded. */
function killbillStatus(payment) {
    if (payment.open_ops > 0)
        return "pending";
    if (payment.ops > 0)
        return "recorded";
    return payment.kind === "invoice" && payment.captured_cents > 0 ? "recorded" : "not_recorded";
}
export function paymentJson(payment) {
    return {
        id: payment.id,
        kind: payment.kind,
        status: payment.status,
        amount_cents: payment.amount_cents,
        captured_cents: payment.captured_cents,
        refunded_cents: payment.refunded_cents,
        applied_cents: payment.applied_cents,
        disposition: payment.disposition,
        booking_id: payment.booking_id,
        invoice_id: payment.invoice_id,
        card_last4: payment.card_last4,
        decline_code: payment.decline_code,
        killbill_status: killbillStatus(payment),
    };
}
/** The latest published token an owner submits is their card on file; only the token and last four are stored. */
export async function setCardOnFile(client, ownerId, token) {
    const last4 = cardLast4(token);
    await client.query(`UPDATE users SET card_token = $2, card_last4 = $3 WHERE id = $1`, [ownerId, token, last4]);
    return last4;
}
/** Authorises an amount on a test card; a decline stores one declined payment row. */
export async function authorisePayment(client, input) {
    const result = authorise(input.token);
    const id = randomUUID();
    const status = result.approved ? "authorized" : "declined";
    await client.query(`INSERT INTO payments (id, kind, status, owner_id, booking_id, invoice_id, amount_cents, card_last4, decline_code, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
        id,
        input.kind,
        status,
        input.ownerId,
        input.bookingId,
        input.invoiceId,
        input.amountCents,
        result.last4,
        result.approved ? null : result.declineCode,
        new Date(now()),
    ]);
    await audit(client, { action: "authorize", entityType: "payment", entityId: id, from: null, to: status });
    return { paymentId: id, result };
}
async function setStatus(client, payment, action, to) {
    if (to !== payment.status) {
        await client.query(`UPDATE payments SET status = $2 WHERE id = $1`, [payment.id, to]);
    }
    await audit(client, { action, entityType: "payment", entityId: payment.id, from: payment.status, to });
}
/** Queues Kill Bill work for a payment; the request (or job) makes the first attempt once it has committed. */
async function queueOp(client, paymentId, kind, refundId) {
    const at = now();
    const fromRequest = currentContext().origin === "request";
    await client.query(`INSERT INTO billing_ops (payment_id, kind, refund_id, next_attempt_at, created_at) VALUES ($1, $2, $3, $4, $5)`, [paymentId, kind, refundId, fromRequest ? plusSeconds(at, config.jobLeaseSeconds) : new Date(at), new Date(at)]);
    afterCommit(async () => {
        await runPaymentOps(paymentId, true);
    });
}
export async function voidPayment(client, payment) {
    checkPaymentAction(payment.status, "void");
    await setStatus(client, payment, "void", "voided");
}
/** Captures an authorised payment; a deposit is then held against its booking and recorded in Kill Bill. */
export async function capturePayment(client, payment) {
    checkPaymentAction(payment.status, "capture");
    await client.query(`UPDATE payments SET captured_cents = amount_cents, captured_at = $2, disposition = CASE WHEN kind = 'deposit' THEN 'held' END
      WHERE id = $1`, [payment.id, new Date(now())]);
    await setStatus(client, payment, "capture", "captured");
    if (payment.kind === "deposit")
        await queueOp(client, payment.id, "capture", null);
}
/** Refunds part of what remains; above the refundable amount answers refund_exceeds_captured. */
export async function refundPayment(client, payment, amountCents, disposition = "keep", at = now()) {
    checkPaymentAction(payment.status, "refund");
    const refundable = refundableCents(payment);
    if (amountCents > refundable)
        throw conflict("refund_exceeds_captured", { refundable_cents: refundable });
    const id = randomUUID();
    await client.query(`INSERT INTO refunds (id, payment_id, amount_cents, purpose, external_key, created_at) VALUES ($1, $2, $3, 'refund', $1, $4)`, [
        id,
        payment.id,
        amountCents,
        new Date(at),
    ]);
    await client.query(`UPDATE payments SET refunded_cents = refunded_cents + $2, disposition = CASE WHEN $3 THEN disposition ELSE $4 END WHERE id = $1`, [payment.id, amountCents, disposition === "keep", disposition === "keep" ? null : disposition]);
    await setStatus(client, payment, "refund", statusAfterRefund(payment, amountCents));
    await queueOp(client, payment.id, "refund", id);
    return id;
}
// ---- Deposit outcomes of booking events (brief: Deposits table) ----
/** Release, lapse, day start or day cancel on a hold: the authorisation is voided. */
export async function voidDeposit(client, paymentId) {
    if (!paymentId)
        return;
    const payment = await lockPayment(client, paymentId);
    if (payment.status === "authorized")
        await voidPayment(client, payment);
}
/** Confirm: captured and held, unless the farrier already captured it during the hold. */
export async function captureDeposit(client, paymentId) {
    if (!paymentId)
        return;
    const payment = await lockPayment(client, paymentId);
    if (payment.status === "authorized")
        await capturePayment(client, payment);
}
/** Cancel in time, excuse or day cancel: a captured deposit is refunded in full, its refund stamped at `at`. */
export async function refundDeposit(client, paymentId, at) {
    if (!paymentId)
        return;
    const payment = await lockPayment(client, paymentId);
    if (payment.status === "authorized")
        return voidPayment(client, payment);
    const refundable = refundableCents(payment);
    if ((payment.status === "captured" || payment.status === "partially_refunded") && refundable > 0) {
        await refundPayment(client, payment, refundable, null, at);
    }
}
/** Cancel late or no-show: the deposit is kept against the trip share. */
export async function forfeitDeposit(client, paymentId) {
    if (!paymentId)
        return;
    const payment = await lockPayment(client, paymentId);
    if (payment.status !== "captured" && payment.status !== "partially_refunded")
        return;
    await client.query(`UPDATE payments SET disposition = 'forfeited' WHERE id = $1`, [payment.id]);
    await audit(client, { action: "forfeit", entityType: "payment", entityId: payment.id, from: payment.status, to: payment.status });
}
/** The deposit left to apply to an invoice: what was captured and not yet refunded or applied. */
export async function depositToApply(client, paymentId) {
    if (!paymentId)
        return 0;
    const payment = await lockPayment(client, paymentId);
    return payment.status === "captured" || payment.status === "partially_refunded" ? refundableCents(payment) : 0;
}
/**
 * Applies the deposit credit to the horse's invoice. A visit invoice marks it applied and refunds any part above
 * the gross; a trip-only invoice keeps it forfeited and refunds nothing (brief: Deposits).
 */
export async function applyDeposit(client, paymentId, creditCents, kind) {
    const payment = await lockPayment(client, paymentId);
    await client.query(`UPDATE payments SET applied_cents = applied_cents + $2, disposition = $3 WHERE id = $1`, [
        payment.id,
        creditCents,
        kind === "visit" ? "applied" : payment.disposition,
    ]);
    await audit(client, { action: "apply", entityType: "payment", entityId: payment.id, from: payment.status, to: payment.status });
    if (kind !== "visit")
        return;
    const after = await lockPayment(client, paymentId);
    const excess = refundableCents(after);
    if (excess > 0)
        await refundPayment(client, after, excess);
}
