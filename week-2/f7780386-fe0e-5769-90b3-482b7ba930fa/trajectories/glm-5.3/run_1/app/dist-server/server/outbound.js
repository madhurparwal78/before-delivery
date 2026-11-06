// Outbound effects: emails, Kill Bill work. Each effect is recorded exactly
// once per business event and retried by the sweep while its dependency is
// down. A dependency outage never fails the action that triggered the effect.
import { pool, newId } from './db.js';
import { instantInZone, kitchenNow, KITCHEN_TZ } from './clock.js';
import { sendMail, MailUnavailable } from './mail.js';
import * as kb from './killbill.js';
import { KillBillUnavailable } from './killbill.js';
import { memberById } from './domain.js';
// ---------------------------------------------------------------------------
// Emails: one per state change, deduplicated by a business key.
// ---------------------------------------------------------------------------
export async function queueEmail(mail, dedupeKey) {
    await pool.query(`INSERT INTO outbound_email (id, to_email, subject, body, dedupe_key, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     ON CONFLICT (dedupe_key) DO NOTHING`, [newId('eml'), mail.to, mail.subject, mail.body, dedupeKey, nowIso()]);
}
function nowIso() {
    return instantInZone(kitchenNow().epochMillis, KITCHEN_TZ);
}
export async function flushEmails() {
    const pending = await pool.query(`SELECT id, to_email, subject, body FROM outbound_email WHERE status = 'pending' ORDER BY created_at ASC LIMIT 50`);
    for (const row of pending.rows) {
        try {
            await sendMail({ to: row.to_email, subject: row.subject, body: row.body });
            await pool.query(`UPDATE outbound_email SET status = 'sent' WHERE id = $1`, [row.id]);
        }
        catch (err) {
            if (!(err instanceof MailUnavailable)) {
                await pool.query(`UPDATE outbound_email SET status = 'failed' WHERE id = $1`, [row.id]);
            }
        }
    }
}
// ---------------------------------------------------------------------------
// Product emails.
// ---------------------------------------------------------------------------
export async function sendBookingConfirmation(booking) {
    const member = await memberById(booking.member_id);
    if (!member)
        return;
    const hours = (booking.prepaid_minutes / 60).toFixed(2);
    const lines = [
        `${booking.station_name} on ${booking.date}, ${booking.start}–${booking.end}.`,
        `Cleaning turnover until ${booking.tail_end}.`,
        `Prepaid hours used: ${hours}`,
        `Overage: $${booking.overage_amount}`,
    ];
    if (booking.payment === 'payment_pending')
        lines.push('Payment pending');
    await queueEmail({ to: member.contact_email, subject: `Booking confirmed: ${booking.station_name} on ${booking.date}`, body: lines.join('\n') }, `booking-confirmed:${booking.id}`);
}
export async function sendCancellationReceipt(booking) {
    const member = await memberById(booking.member_id);
    if (!member)
        return;
    const hours = (booking.prepaid_minutes / 60).toFixed(2);
    const feeLine = booking.fee && booking.fee.status !== 'waived'
        ? `Late-cancellation fee: $${booking.fee.amount}`
        : 'No cancellation fee';
    await queueEmail({
        to: member.contact_email,
        subject: `Booking cancelled: ${booking.station_name} on ${booking.date}`,
        body: [`Hours returned: ${hours}`, feeLine].join('\n'),
    }, `booking-cancelled:${booking.id}`);
}
export async function sendInvoiceNotice(memberId, amount, description) {
    const member = await memberById(memberId);
    if (!member)
        return;
    await queueEmail({
        to: member.contact_email,
        subject: `Invoice notice: $${amount} for ${description}`,
        body: `$${amount} for ${description}.`,
    }, `invoice-notice:${memberId}:${description}:${amount}`);
}
export async function sendExpiryWarning(memberId, documentId, days, label, expiresOn) {
    const member = await memberById(memberId);
    if (!member)
        return;
    await queueEmail({
        to: member.contact_email,
        subject: `Certificate expires in ${days} days: ${label}`,
        body: `${label} expires on ${expiresOn}.`,
    }, `expiry-warning:${documentId}:${days}`);
}
// ---------------------------------------------------------------------------
// Expiry warnings: 14-day and 3-day, judged on the kitchen's today, sent once.
// ---------------------------------------------------------------------------
export async function runExpiryWarningChecks(today) {
    const docs = await pool.query(`SELECT id, member_id, kind, crew_cook_id, expires_on FROM documents WHERE status = 'approved'`);
    for (const doc of docs.rows) {
        const days = daysUntil(today, doc.expires_on);
        let threshold = null;
        if (days <= 14 && days > 3)
            threshold = 14;
        else if (days <= 3 && days >= 0)
            threshold = 3;
        if (!threshold)
            continue;
        const already = await pool.query(`SELECT 1 FROM document_warnings WHERE document_id = $1 AND threshold = $2`, [doc.id, threshold]);
        if ((already.rowCount ?? 0) > 0)
            continue;
        // Record the intent first so a concurrent sweep cannot double-send.
        await pool.query(`INSERT INTO document_warnings (document_id, threshold) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [doc.id, threshold]);
        let label;
        if (doc.kind === 'liability_insurance') {
            label = 'Liability insurance';
        }
        else {
            const cook = doc.crew_cook_id ? await pool.query('SELECT name FROM users WHERE id = $1', [doc.crew_cook_id]) : null;
            label = `Food handler card – ${cook?.rows[0]?.name ?? 'crew cook'}`;
        }
        await sendExpiryWarning(doc.member_id, doc.id, threshold, label, doc.expires_on);
    }
}
function daysUntil(from, to) {
    const a = Date.parse(from + 'T00:00:00Z');
    const b = Date.parse(to + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
}
export async function recordBilling(job) {
    try {
        await performBillingJob(job);
        return 'recorded';
    }
    catch (err) {
        if (err instanceof KillBillUnavailable || err instanceof Error) {
            await enqueueBilling(job);
            return 'queued';
        }
        throw err;
    }
}
async function enqueueBilling(job) {
    await pool.query(`INSERT INTO outbound_billing (id, kind, payload, status, created_at)
     VALUES ($1, $2, $3, 'pending', $4)
     ON CONFLICT (id) DO NOTHING`, [billingJobId(job), job.kind, JSON.stringify(job), nowIso()]);
}
export function billingJobId(job) {
    switch (job.kind) {
        case 'ensure_account':
            return `ensure-account:${job.member_id}`;
        case 'charge_and_pay':
            return `charge-and-pay:${job.booking_id}`;
        case 'charge_only':
            return `charge-only:${job.booking_id}`;
        case 'credit':
            return `credit:${job.booking_id}:${job.description}`;
    }
}
export async function performBillingJob(job) {
    const member = await memberById(job.member_id);
    if (!member)
        throw new Error(`unknown member ${job.member_id}`);
    const accountId = await kb.ensureAccount(job.member_id, member.business_name, member.contact_email);
    switch (job.kind) {
        case 'ensure_account':
            return;
        case 'charge_and_pay': {
            const invoiceId = await kb.chargeAndPay(accountId, job.description, job.amount_cents);
            void invoiceId;
            await sendInvoiceNotice(job.member_id, (job.amount_cents / 100).toFixed(2), job.description);
            return;
        }
        case 'charge_only':
            await kb.chargeOnly(accountId, job.description, job.amount_cents);
            await sendInvoiceNotice(job.member_id, (job.amount_cents / 100).toFixed(2), job.description);
            return;
        case 'credit':
            await kb.createCredit(accountId, job.description, job.amount_cents);
            return;
    }
}
/** Settles every queued billing job; called by the sweep when Kill Bill is up. */
export async function flushBillingQueue() {
    const pending = await pool.query(`SELECT id, kind, payload FROM outbound_billing WHERE status = 'pending' ORDER BY created_at ASC LIMIT 50`);
    for (const row of pending.rows) {
        const job = row.payload;
        try {
            await performBillingJob(job);
            await pool.query(`UPDATE outbound_billing SET status = 'recorded' WHERE id = $1`, [row.id]);
        }
        catch (err) {
            if (!(err instanceof KillBillUnavailable)) {
                // Real Kill Bill rejection: drop the job so it never repeats.
                await pool.query(`UPDATE outbound_billing SET status = 'failed' WHERE id = $1`, [row.id]);
            }
        }
    }
}
