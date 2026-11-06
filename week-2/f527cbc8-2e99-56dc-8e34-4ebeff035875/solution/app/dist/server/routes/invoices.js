// Invoices, honest invoice payments with dunning, payment capture, void and refund, and the Kill Bill read-back
// (brief: API, Invoices, Payments, Reconciliation; Business rules, Paying an invoice, Dunning, Payment states).
import { audit } from "../audit.js";
import { checkOutstandingAlert } from "../alerts.js";
import { invoiceReadBack, ownerAccount, paymentReadBack } from "../billing.js";
import { now as clockNow } from "../clock.js";
import { currentContext, runAfterCommit } from "../context.js";
import { config } from "../config.js";
import { db, first, transaction } from "../db.js";
import { afterManualDecline, afterPayment, afterRetryDecline, inDunning, retrySchedule } from "../domain/dunning.js";
import { bookingTransition, lapsedHoldSql } from "../domain/bookingRules.js";
import { cardTokenError } from "../domain/gateway.js";
import { record } from "../domain/ledger.js";
import { ApiError, FIELD_COPY, conflict, notFound, refuseInvalid } from "../errors.js";
import { checkPaymentAction } from "../domain/payments.js";
import { json, route } from "../http.js";
import { log } from "../log.js";
import { idempotent } from "../idempotency.js";
import { enqueueJob, registerJob } from "../jobs.js";
import { BillingUnavailable, purchaseOnInvoice } from "../killbill.js";
import { dunningMail } from "../mail/messages.js";
import { queueEmail } from "../mail/outbox.js";
import { PAYMENT_SELECT, authorisePayment, capturePayment, lockPayment, paymentJson, refundPayment, setCardOnFile, voidPayment, } from "../payments.js";
import { dayChange, daysChange, ownerBlocked, settleForRead } from "../days.js";
import { INVOICE_SELECT, invoiceJson, nextTryDate } from "../views.js";
import { inRange, objectBody } from "./input.js";
// ---- Invoices ----
async function visibleInvoice(caller, id) {
    const { rows } = await db.query(`${INVOICE_SELECT} WHERE i.id = $1 ${caller.role === "owner" ? "AND i.owner_id = $2" : ""}`, caller.role === "owner" ? [id, caller.id] : [id]);
    const invoice = rows[0];
    if (!invoice)
        throw notFound();
    return invoice;
}
route("GET", "/api/invoices", ["farrier", "owner"], async ({ caller, now }) => {
    const { rows } = await db.query(`${INVOICE_SELECT} ${caller.role === "owner" ? "WHERE i.owner_id = $1" : ""} ORDER BY i.business_date DESC, i.created_at DESC`, caller.role === "owner" ? [caller.id] : []);
    return json(200, rows.map((invoice) => invoiceJson(invoice, now)));
}, { token: "billing" });
route("GET", "/api/invoices/:id/reconciliation", ["farrier"], async ({ caller, params }) => {
    const invoice = await visibleInvoice(caller, params.id ?? "");
    return json(200, await invoiceReadBack(invoice.id));
}, { token: "billing" });
async function dunningFacts(client, invoice) {
    return first((await client.query(`SELECT u.email AS owner_email, u.name AS owner_name, h.name AS horse_name FROM users u, horses h WHERE u.id = $1 AND h.id = $2`, [invoice.owner_id, invoice.horse_id])).rows);
}
/** Moves the invoice's dunning state with one audit entry and the state's one email. */
async function moveDunning(client, invoice, to, at, step) {
    if (to === invoice.dunning_state)
        return;
    await client.query(`UPDATE invoices SET dunning_state = $2 WHERE id = $1`, [invoice.id, to]);
    await audit(client, { action: "dunning", entityType: "dunning", entityId: invoice.id, from: invoice.dunning_state, to });
    if (to === "none")
        return;
    const facts = await dunningFacts(client, invoice);
    const refreshed = first((await client.query(`${INVOICE_SELECT} WHERE i.id = $1`, [invoice.id])).rows);
    await queueEmail(client, `dunning:${invoice.id}:${to}:${step}`, dunningMail({
        to: facts.owner_email,
        name: facts.owner_name,
        state: to,
        horse: facts.horse_name,
        date: invoice.business_date,
        nextTry: nextTryDate(refreshed, at) ?? invoice.business_date,
        balanceCents: invoice.balance_cents,
    }));
}
/** A first decline stamps the retry instants and queues a durable retry job for each. */
async function startDunning(client, invoice, at) {
    const retries = retrySchedule(at, config.dunningRetryDays, config.dunningDaySeconds).map((instant) => new Date(instant));
    await client.query(`UPDATE invoices SET first_declined_at = $2, retry_at = $3 WHERE id = $1`, [invoice.id, new Date(at), retries]);
    for (const [index, runAt] of retries.entries()) {
        await enqueueJob(client, { kind: "dunning_retry", payload: { invoice_id: invoice.id, step: String(index) }, runAt, onceKey: `dunning:${invoice.id}:${index}` });
    }
}
/** The invoice is paid in full: balance 0, the capture recorded in the ledger, dunning cleared, the alert re-checked. */
async function markPaid(client, invoice, payment, at) {
    await capturePayment(client, payment);
    await client.query(`UPDATE invoices SET status = 'paid', balance_cents = 0 WHERE id = $1`, [invoice.id]);
    await audit(client, { action: "pay", entityType: "invoice", entityId: invoice.id, from: invoice.status, to: "paid" });
    await record(client, {
        ref: `invoice_payment:${payment.id}`,
        kind: "invoice_payment",
        amountCents: payment.amount_cents,
        at: new Date(at),
        ownerId: invoice.owner_id,
        horseId: invoice.horse_id,
        businessDate: invoice.business_date,
    });
    await moveDunning(client, invoice, afterPayment(invoice.dunning_state), at, payment.id);
    if (invoice.dunning_state === "blocked" && !(await ownerBlocked(client, invoice.owner_id)))
        await resumeWaitlists(client, invoice.owner_id, at);
    await checkOutstandingAlert(client);
}
/**
 * Paying an owner's last blocked invoice runs the offer pass, in that payment's transaction and stamped at its
 * instant, on every published day where the owner waits (brief: Dunning, Unblocking).
 */
async function resumeWaitlists(client, ownerId, at) {
    const { rows } = await client.query(`SELECT DISTINCT w.barn_day_id AS id FROM waitlist_entries w JOIN barn_days d ON d.id = w.barn_day_id
      WHERE w.owner_id = $1 AND w.left_at IS NULL AND d.status = 'published'`, [ownerId]);
    await daysChange(client, rows.map((row) => row.id), at, async () => undefined);
}
/**
 * Charges the invoice's full balance in the fixed order: authorise on the card, record the external payment in
 * Kill Bill, then capture. Runs under the invoice's row lock, which serialises pays and dunning retries.
 */
async function charge(client, invoice, token, retry, at) {
    const authorised = await authorisePayment(client, {
        kind: "invoice",
        ownerId: invoice.owner_id,
        bookingId: null,
        invoiceId: invoice.id,
        amountCents: invoice.balance_cents,
        token,
    });
    const { result } = authorised;
    if (!result.approved) {
        const state = invoice.dunning_state;
        if (!retry && (state === "none" || state === "cleared"))
            await startDunning(client, invoice, at);
        const next = retry ? afterRetryDecline(state, result.hard) : afterManualDecline(state, result.hard);
        await moveDunning(client, invoice, next, at, authorised.paymentId);
        return { declined: result.declineCode };
    }
    const payment = await lockPayment(client, authorised.paymentId);
    try {
        const account = await ownerAccount(invoice.owner_id);
        await purchaseOnInvoice(account, invoice.killbill_invoice_id ?? "", invoice.balance_cents, `${payment.id}:capture`);
    }
    catch (error) {
        if (!(error instanceof BillingUnavailable))
            throw error;
        log("warn", "Kill Bill unavailable; card payment voided", { invoice_id: invoice.id, error: error.message });
        await voidPayment(client, payment);
        return { unavailable: true };
    }
    await markPaid(client, invoice, payment, at);
    return { paid: true };
}
async function lockInvoice(client, id) {
    await client.query(`SELECT 1 FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
    return first((await client.query(`${INVOICE_SELECT} WHERE i.id = $1`, [id])).rows);
}
route("POST", "/api/invoices/:id/payments", ["owner"], async (ctx) => {
    const { caller, params, now } = ctx;
    const visible = await visibleInvoice(caller, params.id ?? "");
    return idempotent(ctx, async () => {
        const token = objectBody(ctx.body).card_token;
        const outcome = await transaction(async (client) => {
            const invoice = await lockInvoice(client, visible.id);
            if (invoice.status === "pending")
                throw conflict("invoice_pending");
            if (invoice.status === "paid")
                throw conflict("already_paid");
            const problem = cardTokenError(token);
            if (problem)
                refuseInvalid({ card_token: problem });
            await setCardOnFile(client, caller.id, String(token));
            const result = await charge(client, invoice, String(token), false, now);
            return { result, invoice: first((await client.query(`${INVOICE_SELECT} WHERE i.id = $1`, [invoice.id])).rows) };
        });
        if ("declined" in outcome.result)
            throw new ApiError(402, "card_declined", { decline_code: outcome.result.declined });
        if ("unavailable" in outcome.result)
            throw new ApiError(503, "billing_unavailable");
        return json(201, invoiceJson(outcome.invoice, now));
    });
}, { allowance: "payment" });
/** A scheduled retry charges the card on file; a retry that cannot reach Kill Bill fails as a job and changes nothing. */
registerJob("dunning_retry", {
    run: async (job) => {
        const at = clockNow();
        const invoiceId = job.payload.invoice_id ?? "";
        const step = Number(job.payload.step);
        const expected = ["past_due", "retry_1", "retry_2"];
        const outcome = await transaction(async (client) => {
            const invoice = await lockInvoice(client, invoiceId);
            if (invoice.status !== "unpaid" || !inDunning(invoice.dunning_state) || invoice.dunning_state !== expected[step]) {
                return null;
            }
            const card = first((await client.query(`SELECT card_token FROM users WHERE id = $1`, [invoice.owner_id])).rows);
            return charge(client, invoice, String(card.card_token), true, at);
        });
        if (outcome && "unavailable" in outcome)
            throw new BillingUnavailable("Kill Bill unreachable during the dunning retry");
        return null;
    },
});
// ---- Payments ----
async function visiblePayment(caller, id) {
    const { rows } = await db.query(`${PAYMENT_SELECT} WHERE p.id = $1 ${caller.role === "owner" ? "AND p.owner_id = $2" : ""}`, caller.role === "owner" ? [id, caller.id] : [id]);
    const payment = rows[0];
    if (!payment)
        throw notFound();
    return payment;
}
/** Deposits of holds that lapsed read voided at that instant: the days are settled before the read answers. */
async function settlePaymentsDays(payments, at) {
    const bookings = payments.map((p) => p.booking_id).filter((id) => id !== null);
    if (!bookings.length)
        return;
    const { rows } = await db.query(`SELECT DISTINCT barn_day_id FROM bookings bk WHERE bk.id = ANY($1) AND ${lapsedHoldSql("bk", "$2")}`, [bookings, new Date(at)]);
    await settleForRead(rows.map((row) => row.barn_day_id), at);
}
route("GET", "/api/payments", ["farrier", "owner"], async ({ caller, query, now }) => {
    const filters = [];
    const values = [];
    const add = (sql, value) => {
        values.push(value);
        filters.push(sql.replace("?", `$${values.length}`));
    };
    if (caller.role === "owner")
        add("p.owner_id = ?", caller.id);
    if (query.get("booking_id"))
        add("p.booking_id = ?", query.get("booking_id"));
    if (query.get("invoice_id"))
        add("p.invoice_id = ?", query.get("invoice_id"));
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const first_ = await db.query(`${PAYMENT_SELECT} ${where} ORDER BY p.created_at`, values);
    await settlePaymentsDays(first_.rows, now);
    const { rows } = await db.query(`${PAYMENT_SELECT} ${where} ORDER BY p.created_at`, values);
    return json(200, rows.map(paymentJson));
}, { token: "billing" });
route("GET", "/api/payments/:id", ["farrier", "owner"], async ({ caller, params, now }) => {
    await settlePaymentsDays([await visiblePayment(caller, params.id ?? "")], now);
    return json(200, paymentJson(await visiblePayment(caller, params.id ?? "")));
}, { token: "billing" });
route("GET", "/api/payments/:id/reconciliation", ["farrier"], async ({ caller, params }) => {
    const payment = await visiblePayment(caller, params.id ?? "");
    return json(200, await paymentReadBack(payment.id));
}, { token: "billing" });
/**
 * Runs a payment action under the barn day's lock when the payment is a booking's deposit, then its Kill Bill
 * work, and answers with the payment as it then stands.
 */
async function onPayment(payment, at, work) {
    if (!payment.booking_id)
        await transaction(work);
    else {
        const day = first((await db.query(`SELECT barn_day_id FROM bookings WHERE id = $1`, [payment.booking_id])).rows);
        await transaction((client) => dayChange(client, day.barn_day_id, at, () => work(client)));
    }
    await runAfterCommit(currentContext());
    return first((await db.query(`${PAYMENT_SELECT} WHERE p.id = $1`, [payment.id])).rows);
}
route("POST", "/api/payments/:id/capture", ["farrier"], async (ctx) => {
    const visible = await visiblePayment(ctx.caller, ctx.params.id ?? "");
    return idempotent(ctx, async () => {
        const payment = await onPayment(visible, ctx.now, async (client) => {
            await capturePayment(client, await lockPayment(client, visible.id));
        });
        return json(200, paymentJson(payment));
    });
});
/** Voiding a held booking's deposit also releases the hold. */
route("POST", "/api/payments/:id/void", ["farrier"], async (ctx) => {
    const visible = await visiblePayment(ctx.caller, ctx.params.id ?? "");
    return idempotent(ctx, async () => {
        const payment = await onPayment(visible, ctx.now, async (client) => {
            await voidPayment(client, await lockPayment(client, visible.id));
            if (visible.booking_id) {
                const { rows } = await client.query(`SELECT status FROM bookings WHERE id = $1`, [visible.booking_id]);
                const status = first(rows).status;
                if (status === "held") {
                    const next = bookingTransition(status, "release");
                    await client.query(`UPDATE bookings SET status = $2 WHERE id = $1`, [visible.booking_id, next]);
                    await audit(client, { action: "release", entityType: "booking", entityId: visible.booking_id, from: status, to: next });
                }
            }
        });
        return json(200, paymentJson(payment));
    });
});
route("POST", "/api/payments/:id/refund", ["farrier"], async (ctx) => {
    const visible = await visiblePayment(ctx.caller, ctx.params.id ?? "");
    return idempotent(ctx, async () => {
        const amount = objectBody(ctx.body).amount_cents;
        const payment = await onPayment(visible, ctx.now, async (client) => {
            const locked = await lockPayment(client, visible.id);
            checkPaymentAction(locked.status, "refund");
            if (!inRange(amount, 1, Number.MAX_SAFE_INTEGER))
                refuseInvalid({ amount_cents: FIELD_COPY.range(1, locked.amount_cents) });
            await refundPayment(client, locked, Number(amount));
        });
        return json(200, paymentJson(payment));
    });
}, { token: "billing" });
