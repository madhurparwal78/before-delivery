// Kill Bill legs for invoices and payments (brief: Services, Kill Bill; Business rules, Crash-safe close, Billing
// outage, Read-back). Every leg first reads Kill Bill and adopts what an earlier attempt left, found by the invoice
// marker in item descriptions or by a transaction's external key, so a retry, a takeover or the reconciler on any
// instance finishes the work with one invoice, one transfer and one ledger set.
import { audit } from "./audit.js";
import { now, plusSeconds } from "./clock.js";
import { config } from "./config.js";
import { connect, db, first, transaction } from "./db.js";
import { record } from "./domain/ledger.js";
import { lastVisitDateSql, nextDue } from "./domain/nextDue.js";
import { BillingUnavailable, accountInvoices, accountPayments, billingReachable, createCharges, creditedCents, ensureAccount, findInvoice, findPayment, getInvoice, invoicePayments, purchaseOnInvoice, refundPayment, toCents, } from "./killbill.js";
import { log } from "./log.js";
import { visitSummaryMail } from "./mail/messages.js";
import { queueEmail } from "./mail/outbox.js";
import { checkOutstandingAlert } from "./alerts.js";
import { dayChange } from "./days.js";
import { today } from "./practice.js";
const HOLD_OFF_S = 20;
const RETRY_S = 5;
/** The owner's Kill Bill account, created exactly once even under simultaneous requests (advisory lock per owner). */
export async function ownerAccount(ownerId) {
    return transaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('killbill-account:' || $1))`, [ownerId]);
        const owner = first((await client.query(`SELECT name, email, killbill_account_id, killbill_payment_method_id FROM users WHERE id = $1`, [ownerId])).rows);
        if (owner.killbill_account_id && owner.killbill_payment_method_id) {
            return { accountId: owner.killbill_account_id, paymentMethodId: owner.killbill_payment_method_id };
        }
        const account = await ensureAccount(owner);
        await client.query(`UPDATE users SET killbill_account_id = $2, killbill_payment_method_id = $3 WHERE id = $1`, [
            ownerId,
            account.accountId,
            account.paymentMethodId,
        ]);
        return account;
    });
}
/** Holds a transaction-scoped advisory lock on a dedicated connection while `work` runs; null when busy and `wait` is false. */
async function exclusive(name, wait, work) {
    const client = await connect();
    try {
        await client.query("BEGIN");
        if (wait)
            await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [name]);
        else {
            const { rows } = await client.query(`SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok`, [name]);
            if (!rows[0]?.ok) {
                await client.query("ROLLBACK");
                return null;
            }
        }
        try {
            return await work();
        }
        finally {
            await client.query("ROLLBACK");
        }
    }
    finally {
        client.release();
    }
}
const paymentFacts = async (client, paymentId) => first((await client.query(`SELECT p.id, p.kind, p.owner_id, p.amount_cents, p.captured_at,
                coalesce(bh.id, ih.id) AS horse_id, coalesce(bh.name, ih.name) AS horse_name,
                coalesce(d.business_date, i.business_date) AS business_date, i.killbill_invoice_id AS invoice_kb_id
           FROM payments p
           LEFT JOIN bookings bk ON bk.id = p.booking_id
           LEFT JOIN horses bh ON bh.id = bk.horse_id
           LEFT JOIN barn_days d ON d.id = bk.barn_day_id
           LEFT JOIN invoices i ON i.id = p.invoice_id
           LEFT JOIN horses ih ON ih.id = i.horse_id
          WHERE p.id = $1`, [paymentId])).rows);
const ledgerFor = (facts) => ({
    ownerId: facts.owner_id,
    horseId: facts.horse_id,
    businessDate: facts.business_date,
});
/** The Kill Bill invoice a payment's money sits on: its deposit invoice, or the invoice it paid. */
async function paymentInvoice(account, facts) {
    if (facts.kind === "invoice" && facts.invoice_kb_id)
        return getInvoice(facts.invoice_kb_id);
    const existing = findInvoice(await accountInvoices(account.accountId), facts.id);
    if (existing)
        return existing;
    return createCharges(account.accountId, [
        { description: `Booking deposit — ${facts.horse_name} ${facts.business_date} [${facts.id}]`, amount_cents: facts.amount_cents },
    ]);
}
async function runOp(op, facts) {
    const account = await ownerAccount(facts.owner_id);
    const captureKey = `${facts.id}:capture`;
    if (op.kind === "capture") {
        const invoice = await paymentInvoice(account, facts);
        if (!findPayment(await accountPayments(account.accountId), captureKey)) {
            await purchaseOnInvoice(account, invoice.invoiceId, facts.amount_cents, captureKey);
        }
        await record(db, {
            ref: `deposit_captured:${facts.id}`,
            kind: "deposit_captured",
            amountCents: facts.amount_cents,
            at: facts.captured_at ?? new Date(now()),
            ...ledgerFor(facts),
        });
        return;
    }
    const refund = first((await db.query(`SELECT id, amount_cents, external_key, created_at FROM refunds WHERE id = $1`, [op.refund_id])).rows);
    const payments = await accountPayments(account.accountId);
    const paid = findPayment(payments, captureKey);
    if (!paid)
        throw new BillingUnavailable(`Kill Bill has no capture for payment ${facts.id}`);
    if (!findPayment(payments, refund.external_key)) {
        await refundPayment(paid.paymentId, refund.amount_cents, refund.external_key, await paymentInvoice(account, facts));
    }
    await record(db, { ref: `refund:${refund.id}`, kind: "refund", amountCents: refund.amount_cents, at: refund.created_at, ...ledgerFor(facts) });
}
/**
 * Runs a payment's open Kill Bill work in order. The request that queued it passes `first`; otherwise only work
 * past its hold-off runs. A failure leaves that op and every later one waiting 20 s. Returns true when no work is
 * left open.
 */
export async function runPaymentOps(paymentId, first_ = false) {
    const done = await exclusive(`payment-ops:${paymentId}`, first_, async () => {
        const { rows: ops } = await db.query(`SELECT id, kind, refund_id, next_attempt_at FROM billing_ops WHERE payment_id = $1 AND done_at IS NULL ORDER BY id`, [paymentId]);
        if (!ops.length)
            return true;
        const facts = await paymentFacts(db, paymentId);
        for (const op of ops) {
            if (!first_ && op.next_attempt_at.getTime() > now())
                return false;
            try {
                await runOp(op, facts);
            }
            catch (error) {
                if (!(error instanceof BillingUnavailable))
                    throw error;
                await db.query(`UPDATE billing_ops SET next_attempt_at = $2 WHERE payment_id = $1 AND done_at IS NULL`, [
                    paymentId,
                    plusSeconds(now(), HOLD_OFF_S),
                ]);
                log("warn", "Kill Bill unavailable; payment work pending", { payment_id: paymentId, error: error.message });
                return false;
            }
            await db.query(`UPDATE billing_ops SET done_at = $2 WHERE id = $1`, [op.id, new Date(now())]);
        }
        return true;
    });
    return done ?? false;
}
const invoiceFacts = async (client, id) => (await client.query(`SELECT i.id, i.kind, i.status, i.owner_id, u.name AS owner_name, u.email AS owner_email, i.horse_id, h.name AS horse_name,
              h.cycle_weeks, i.visit_id, i.barn_day_id, i.business_date, i.items, i.gross_cents, i.credit_cents, i.total_cents,
              i.balance_cents, i.deposit_payment_id
         FROM invoices i JOIN users u ON u.id = i.owner_id JOIN horses h ON h.id = i.horse_id WHERE i.id = $1`, [id])).rows[0] ?? null;
/** The Kill Bill legs: charges, then the deposit transfer (out of the deposit payment, into this invoice). */
async function invoiceLegs(invoice) {
    const account = await ownerAccount(invoice.owner_id);
    const ledger = { ownerId: invoice.owner_id, horseId: invoice.horse_id, businessDate: invoice.business_date };
    const kb = findInvoice(await accountInvoices(account.accountId), invoice.id) ??
        (await createCharges(account.accountId, invoice.items.filter((item) => item.amount_cents > 0).map((item) => ({ ...item, description: `${item.description} [${invoice.id}]` }))));
    await record(db, { ref: `billed:${invoice.id}`, kind: "billed", amountCents: invoice.gross_cents, ...ledger });
    if (invoice.credit_cents > 0 && invoice.deposit_payment_id) {
        if (!(await runPaymentOps(invoice.deposit_payment_id, true)))
            throw new BillingUnavailable("deposit work still pending");
        const depositId = invoice.deposit_payment_id;
        const payments = await accountPayments(account.accountId);
        const deposit = findPayment(payments, `${depositId}:capture`);
        if (!deposit)
            throw new BillingUnavailable(`Kill Bill has no capture for deposit ${depositId}`);
        const outKey = `${invoice.id}:deposit-out`;
        const inKey = `${invoice.id}:deposit-in`;
        if (!findPayment(payments, outKey)) {
            const depositInvoice = findInvoice(await accountInvoices(account.accountId), depositId);
            if (!depositInvoice)
                throw new BillingUnavailable(`Kill Bill has no invoice for deposit ${depositId}`);
            await refundPayment(deposit.paymentId, invoice.credit_cents, outKey, depositInvoice);
        }
        if (!findPayment(payments, inKey))
            await purchaseOnInvoice(account, kb.invoiceId, invoice.credit_cents, inKey);
        await record(db, { ref: `transfer_out:${invoice.id}`, kind: "deposit_transfer_out", amountCents: invoice.credit_cents, ...ledger });
        await record(db, { ref: `transfer_in:${invoice.id}`, kind: "deposit_transfer_in", amountCents: invoice.credit_cents, ...ledger });
    }
    return kb.invoiceId;
}
async function lastVisitDate(client, horseId) {
    const { rows } = await client.query(`SELECT ${lastVisitDateSql("$1")} AS date`, [horseId]);
    return rows[0]?.date ?? null;
}
/** Every leg is in Kill Bill: the invoice reads unpaid (paid at a zero balance), its visit invoiced, the email queued. */
async function finishInvoice(invoice, kbInvoiceId) {
    const finish = async (client) => {
        const locked = await client.query(`SELECT status FROM invoices WHERE id = $1 FOR UPDATE`, [invoice.id]);
        if (locked.rows[0]?.status !== "pending")
            return;
        const status = invoice.balance_cents === 0 ? "paid" : "unpaid";
        await client.query(`UPDATE invoices SET status = $2, killbill_invoice_id = $3, next_attempt_at = NULL WHERE id = $1`, [
            invoice.id,
            status,
            kbInvoiceId,
        ]);
        await audit(client, { action: "invoice", entityType: "invoice", entityId: invoice.id, from: "pending", to: status });
        if (invoice.visit_id) {
            const visit = await client.query(`SELECT status FROM visits WHERE id = $1 FOR UPDATE`, [invoice.visit_id]);
            const from = visit.rows[0]?.status ?? "closed";
            await client.query(`UPDATE visits SET status = 'invoiced' WHERE id = $1`, [invoice.visit_id]);
            await audit(client, { action: "invoice", entityType: "visit", entityId: invoice.visit_id, from, to: "invoiced" });
            const due = nextDue(await lastVisitDate(client, invoice.horse_id), invoice.cycle_weeks, today(now()));
            await queueEmail(client, `visit-summary:${invoice.id}`, visitSummaryMail({
                to: invoice.owner_email,
                name: invoice.owner_name,
                horse: invoice.horse_name,
                date: invoice.business_date,
                items: invoice.items,
                totalCents: invoice.total_cents,
                nextDue: due.next_due_date ?? "",
            }));
        }
        await checkOutstandingAlert(client);
    };
    await transaction((client) => (invoice.barn_day_id ? dayChange(client, invoice.barn_day_id, now(), () => finish(client)) : finish(client)));
}
/** A failed attempt: the visit reads invoice_pending; the first failure starts the 20 s hold-off. */
async function invoiceFailed(invoice, error) {
    const work = async (client) => {
        const at = now();
        const { rows } = await client.query(`SELECT failed_at FROM invoices WHERE id = $1 FOR UPDATE`, [invoice.id]);
        const firstFailure = !rows[0]?.failed_at;
        await client.query(`UPDATE invoices SET failed_at = coalesce(failed_at, $3), next_attempt_at = $2 WHERE id = $1 AND status = 'pending'`, [
            invoice.id,
            plusSeconds(at, firstFailure ? HOLD_OFF_S : RETRY_S),
            new Date(at),
        ]);
        if (!invoice.visit_id)
            return;
        const moved = await client.query(`UPDATE visits SET status = 'invoice_pending' WHERE id = $1 AND status = 'closed'`, [invoice.visit_id]);
        if (moved.rowCount) {
            await audit(client, { action: "invoice_failed", entityType: "visit", entityId: invoice.visit_id, from: "closed", to: "invoice_pending" });
        }
    };
    await transaction((client) => (invoice.barn_day_id ? dayChange(client, invoice.barn_day_id, now(), () => work(client)) : work(client)));
    log("warn", "Kill Bill unavailable; invoice pending", { invoice_id: invoice.id, error: error.message });
}
/**
 * Creates a pending invoice in Kill Bill and finishes it. The request that wrote the invoice (or a same-key
 * takeover) waits for any other worker; the reconciler skips an invoice another instance is working on.
 */
export async function advanceInvoice(invoiceId, wait) {
    await exclusive(`invoice:${invoiceId}`, wait, async () => {
        const invoice = await invoiceFacts(db, invoiceId);
        if (!invoice || invoice.status !== "pending")
            return;
        let kbInvoiceId;
        try {
            kbInvoiceId = await invoiceLegs(invoice);
        }
        catch (error) {
            if (!(error instanceof BillingUnavailable))
                throw error;
            await invoiceFailed(invoice, error);
            return;
        }
        await finishInvoice(invoice, kbInvoiceId);
    });
}
/** Time an invoice written by a request waits before the reconciler may take it (the writer's own attempt). */
export const creatorLease = (at) => plusSeconds(at, config.jobLeaseSeconds);
/** One reconciliation pass: only an instance that can reach Kill Bill claims due pending invoices and payment work. */
export async function reconcileBilling() {
    const at = now();
    const due = await db.query(`SELECT 1 FROM invoices WHERE status = 'pending' AND next_attempt_at <= $1
     UNION ALL SELECT 1 FROM billing_ops WHERE done_at IS NULL AND next_attempt_at <= $1 LIMIT 1`, [new Date(at)]);
    if (!due.rowCount || !(await billingReachable()))
        return;
    const { rows: ops } = await db.query(`SELECT DISTINCT payment_id FROM billing_ops WHERE done_at IS NULL AND next_attempt_at <= $1`, [new Date(at)]);
    for (const op of ops)
        await runPaymentOps(op.payment_id);
    const { rows: invoices } = await db.query(`SELECT id FROM invoices WHERE status = 'pending' AND next_attempt_at <= $1 ORDER BY next_attempt_at LIMIT 20`, [new Date(at)]);
    for (const invoice of invoices)
        await advanceInvoice(invoice.id, false);
}
function compare(app, killbill) {
    if (!killbill)
        return { status: "unavailable", app, killbill: null, differences: [] };
    const differences = ["total", "paid", "refunded", "balance"]
        .filter((field) => app[field] !== killbill[field])
        .map((field) => ({ field, app_cents: app[field], killbill_cents: killbill[field] }));
    return { status: differences.length ? "mismatch" : "matched", app, killbill, differences };
}
/**
 * Compares an invoice with a live Kill Bill read. `total` is the charges after adjustments, `paid` the purchases
 * against it (deposit credit and card), `refunded` the refunds against those purchases, `balance` the balance.
 */
export async function invoiceReadBack(invoiceId) {
    const invoice = first((await db.query(`SELECT status, killbill_invoice_id, gross_cents, credit_cents, balance_cents FROM invoices WHERE id = $1`, [invoiceId])).rows);
    const card = first((await db.query(`SELECT coalesce(sum(captured_cents), 0)::int AS captured, coalesce(sum(refunded_cents), 0)::int AS refunded
           FROM payments WHERE invoice_id = $1 AND kind = 'invoice'`, [invoiceId])).rows);
    const app = {
        total: invoice.gross_cents - card.refunded,
        paid: invoice.credit_cents + card.captured,
        refunded: card.refunded,
        balance: invoice.balance_cents,
    };
    let killbill = null;
    if (invoice.status !== "pending" && invoice.killbill_invoice_id) {
        try {
            const [kb, payments] = await Promise.all([getInvoice(invoice.killbill_invoice_id), invoicePayments(invoice.killbill_invoice_id)]);
            killbill = {
                total: toCents(kb.amount),
                paid: payments.reduce((sum, p) => sum + toCents(p.purchasedAmount), 0),
                refunded: -toCents(kb.refundAdj),
                balance: toCents(kb.balance),
            };
        }
        catch (error) {
            if (!(error instanceof BillingUnavailable))
                throw error;
        }
    }
    const result = compare(app, killbill);
    if (result.status !== "unavailable") {
        await transaction(async (client) => {
            const { rows } = await client.query(`SELECT mismatch_audited, reconciliation FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
            const stored = first(rows);
            await client.query(`UPDATE invoices SET reconciliation = $2, mismatch_audited = mismatch_audited OR $3 WHERE id = $1`, [
                invoiceId,
                result.status,
                result.status === "mismatch",
            ]);
            if (result.status === "mismatch" && !stored.mismatch_audited) {
                await audit(client, { action: "reconcile", entityType: "invoice", entityId: invoiceId, from: stored.reconciliation, to: "mismatch" });
            }
        });
    }
    return result;
}
/** Compares a payment with Kill Bill: total and paid are the capture, refunded counts refunds and applied credit. */
export async function paymentReadBack(paymentId) {
    const payment = first((await db.query(`SELECT p.captured_cents, p.refunded_cents, p.applied_cents, p.owner_id,
                (SELECT count(*)::int FROM billing_ops o WHERE o.payment_id = p.id AND o.done_at IS NULL) AS open_ops,
                array(SELECT r.external_key FROM refunds r WHERE r.payment_id = p.id
                      UNION ALL
                      SELECT i.id || ':deposit-out' FROM invoices i WHERE i.deposit_payment_id = p.id AND i.credit_cents > 0) AS refund_keys
           FROM payments p WHERE p.id = $1`, [paymentId])).rows);
    const refunded = payment.refunded_cents + payment.applied_cents;
    const app = { total: payment.captured_cents, paid: payment.captured_cents, refunded, balance: payment.captured_cents - refunded };
    let killbill = null;
    if (payment.captured_cents > 0 && payment.open_ops === 0) {
        try {
            const account = await ownerAccount(payment.owner_id);
            const payments = await accountPayments(account.accountId);
            const kb = findPayment(payments, `${paymentId}:capture`);
            if (kb) {
                const purchased = toCents(kb.purchasedAmount);
                // External refunds land as CREDIT transactions on payments of their own, found by our refund keys.
                const back = creditedCents(payments, new Set(payment.refund_keys));
                killbill = { total: purchased, paid: purchased, refunded: back, balance: purchased - back };
            }
        }
        catch (error) {
            if (!(error instanceof BillingUnavailable))
                throw error;
        }
    }
    return compare(app, killbill);
}
