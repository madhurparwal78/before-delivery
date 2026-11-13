// Cancellation with refund: newest payment first, one REFUND per payment with a stable key, voids, and a resumable run.
import { randomUUID } from "node:crypto";
import { pool, rows, transaction } from "../db.js";
import { FIELD_COPY, invalid } from "../errors.js";
import * as killbill from "../killbill.js";
import { queueEmail } from "../outbox.js";
import { majorToMinor } from "../../shared/money.js";
import { contactEmail, engagementJson, ledgerOf, loadEngagement, setStage, stageOf } from "./engagements.js";
import { clearBlockIfDone, noticeContext } from "./invoices.js";
import { refundNotice } from "./notices.js";
import { cancelTransition } from "./states.js";
/**
 * Splits a refund over confirmed payments, newest first, each part no more than what that payment still holds.
 * `already` maps payment ids to amounts already refunded from them.
 */
function allocateRefund(payments, already, refundMinor) {
    let remaining = refundMinor;
    const parts = [];
    for (const payment of [...payments].reverse()) {
        if (remaining <= 0)
            break;
        const available = payment.amount_minor - (already.get(payment.killbill_payment_id) ?? 0);
        const take = Math.min(available, remaining);
        if (take > 0) {
            parts.push({ killbill_payment_id: payment.killbill_payment_id, amount_minor: take });
            remaining -= take;
        }
    }
    return parts;
}
const refundKey = (engagementId, paymentId) => `${engagementId}:refund:${paymentId}`;
export async function cancelEngagement(engagementId, body, origin, now) {
    const outcome = await transaction(async (client) => {
        const engagement = await loadEngagement(client, engagementId, null, true);
        const next = cancelTransition(stageOf(engagement));
        const ledger = await ledgerOf(client, engagementId);
        const payments = ledger.filter((e) => e.kind !== "refund");
        const paidMinor = payments.reduce((sum, e) => sum + e.amount_minor, 0);
        const refunded = new Map();
        for (const e of ledger.filter((entry) => entry.kind === "refund"))
            refunded.set(e.killbill_payment_id, (refunded.get(e.killbill_payment_id) ?? 0) + e.amount_minor);
        const refundMinor = body.refund_minor;
        const alreadyMinor = [...refunded.values()].reduce((a, b) => a + b, 0);
        if (typeof refundMinor !== "number" || !Number.isInteger(refundMinor) || refundMinor < 1 || refundMinor > paidMinor || refundMinor < alreadyMinor) {
            throw invalid("refund_minor", FIELD_COPY.refund_minor);
        }
        // Refunds an interrupted run made in Kill Bill but never recorded count first, then only the remainder is refunded.
        for (const payment of payments) {
            if (refunded.has(payment.killbill_payment_id))
                continue;
            const found = (await killbill.paymentTransactions(payment.killbill_payment_id)).find((t) => t.transactionType === "REFUND" && t.status === "SUCCESS" && t.transactionExternalKey === refundKey(engagementId, payment.killbill_payment_id));
            if (found) {
                // Kill Bill reports the amount as a JSON number; its decimal text is read exactly into minor units.
                const amount = majorToMinor(String(found.amount), engagement.currency);
                await recordRefund(engagementId, payment.killbill_payment_id, amount, engagement.currency);
                refunded.set(payment.killbill_payment_id, amount);
            }
        }
        const parts = allocateRefund(payments, refunded, refundMinor - [...refunded.values()].reduce((a, b) => a + b, 0));
        for (const part of parts) {
            await killbill.refundPayment(part.killbill_payment_id, engagement.currency, part.amount_minor, refundKey(engagementId, part.killbill_payment_id));
            await recordRefund(engagementId, part.killbill_payment_id, part.amount_minor, engagement.currency);
            refunded.set(part.killbill_payment_id, part.amount_minor);
        }
        const voided = [];
        const open = await rows(client, "SELECT id, status, killbill_invoice_id FROM invoices WHERE engagement_id = $1 AND status IN ('draft', 'issued', 'payment_failed', 'overdue') ORDER BY created_at", [engagementId]);
        for (const invoice of open) {
            if (invoice.status !== "draft" && invoice.killbill_invoice_id)
                await killbill.voidInvoice(invoice.killbill_invoice_id);
            await client.query("UPDATE invoices SET status = 'void' WHERE id = $1", [invoice.id]);
            voided.push(invoice.id);
        }
        await clearBlockIfDone(client, engagement.brand_id);
        await setStage(client, engagementId, next);
        await client.query("UPDATE review_links SET revoked_at = $2 WHERE engagement_id = $1 AND revoked_at IS NULL", [engagementId, now]);
        const allParts = payments
            .slice()
            .reverse()
            .filter((p) => refunded.has(p.killbill_payment_id))
            .map((p) => ({ killbill_payment_id: p.killbill_payment_id, amount_minor: refunded.get(p.killbill_payment_id) ?? 0 }));
        const refundedMinor = allParts.reduce((sum, p) => sum + p.amount_minor, 0);
        const context = await noticeContext(client, engagement, origin, now);
        await queueEmail(client, refundNotice(context, await contactEmail(client, engagement.brand_id, "finance"), allParts, refundedMinor));
        return { allParts, voided, paidMinor, refundedMinor };
    });
    const engagement = await loadEngagement(pool, engagementId, null);
    const entries = (await ledgerOf(pool, engagementId)).filter((e) => e.kind === "refund");
    return {
        engagement: await engagementJson(pool, engagement, "studio", now),
        ledger_entries: entries,
        refunds: outcome.allParts,
        voided_invoice_ids: outcome.voided,
        paid_minor: outcome.paidMinor,
        refunded_minor: outcome.refundedMinor,
        retained_minor: outcome.paidMinor - outcome.refundedMinor,
    };
}
/** One refund ledger entry per payment touched, committed at once so an interrupted run keeps it. */
async function recordRefund(engagementId, paymentId, amountMinor, currency) {
    await pool.query("INSERT INTO ledger_entries (id, engagement_id, kind, amount_minor, currency, invoice_id, killbill_payment_id) VALUES ($1, $2, 'refund', $3, $4, NULL, $5) ON CONFLICT DO NOTHING", [randomUUID(), engagementId, amountMinor, currency, paymentId]);
}
