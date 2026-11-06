import { withTx } from './db.js';
import { config } from './config.js';
import { now, businessDate, practiceZoneName } from './time.js';
import { AppError } from './errors.js';
import { ledgerEntry } from './ledger.js';
import { audit, systemActor } from './audit.js';
import { newId, cardOutcome } from './domain.js';
import { queueEmail } from './mail.js';
import { emails as T } from './email-templates.js';
import { SERVICE_NAMES } from './services.js';
export async function priceListFor(tx, businessDate) {
    const rows = await tx.query(`select * from price_lists where effective_from <= $1 order by effective_from desc limit 1`, [businessDate]);
    return rows[0] ?? null;
}
export function buildInvoiceItems(work, horseName, share, barnName, businessDate, prices, depositLeft) {
    const items = [];
    for (const code of work) {
        items.push({ description: `${SERVICE_NAMES[code]} — ${horseName}`, amount_cents: prices[code] });
    }
    if (share > 0) {
        items.push({ description: `Trip share — ${barnName} ${businessDate}`, amount_cents: share });
    }
    const gross = items.reduce((s, i) => s + i.amount_cents, 0);
    const credit = Math.min(depositLeft, gross);
    if (depositLeft > 0) {
        items.push({ description: `Deposit credit — ${horseName} ${businessDate}`, amount_cents: -credit });
    }
    return { items, total: items.reduce((s, i) => s + i.amount_cents, 0) };
}
export function dunningNextTry(firstDeclinedAt, retryIndex) {
    const day = config.dunningRetryDays[Math.min(retryIndex, config.dunningRetryDays.length - 1)] ?? config.dunningRetryDays[config.dunningRetryDays.length - 1];
    return new Date(firstDeclinedAt.getTime() + day * config.dunningDaySeconds * 1000);
}
export async function enterDunning(tx, invoiceId, declineCode, actorRequestId) {
    const invoice = (await tx.query(`select * from invoices where id = $1 for update`, [invoiceId]))[0];
    if (!invoice || invoice.dunning_state !== 'none')
        return;
    const t = now();
    await tx.query(`update invoices set first_declined_at = $2 where id = $1`, [invoiceId, t]);
    const hard = declineCode === 'do_not_honor' || declineCode === 'unknown_card';
    if (hard) {
        await tx.query(`update invoices set dunning_state = 'blocked' where id = $1`, [invoiceId]);
        await audit(tx, systemActor(), 'blocked', 'dunning', invoiceId, 'none', 'blocked', actorRequestId);
        await enqueueDunningEmail(tx, invoiceId, 'blocked');
        return;
    }
    await tx.query(`update invoices set dunning_state = 'past_due' where id = $1`, [invoiceId]);
    await audit(tx, systemActor(), 'past_due', 'dunning', invoiceId, 'none', 'past_due', actorRequestId);
    await enqueueDunningEmail(tx, invoiceId, 'past_due');
    for (let i = 0; i < config.dunningRetryDays.length; i++) {
        const { enqueueJob } = await import('./jobs.js');
        await enqueueJob(tx, 'dunning_retry', dunningNextTry(t, i), { invoice_id: invoiceId, retry_index: i });
    }
}
async function enqueueDunningEmail(tx, invoiceId, state) {
    const rows = await tx.query(`select i.business_date, i.owner_id, h.name as horse_name, u.email, i.first_declined_at
     from invoices i join horses h on h.id = i.horse_id join users u on u.id = i.owner_id where i.id = $1`, [invoiceId]);
    if (rows.length === 0)
        return;
    const inv = rows[0];
    const stateIndex = ['past_due', 'retry_1', 'retry_2'].indexOf(state);
    const nextIdx = stateIndex >= 0 ? stateIndex + 1 : 0;
    const nextTry = dunningNextTry(inv.first_declined_at ?? now(), nextIdx);
    const nextTryDate = businessDate(practiceZoneName(), nextTry);
    const msg = T.dunningEmail(state, inv.horse_name, inv.business_date, nextTryDate);
    await queueEmail(tx, { to: inv.email, subject: msg.subject, body: msg.body }, false);
}
export async function attemptDunningRetry(invoiceId, retryIndex) {
    await withTx(async (tx) => {
        const invoice = (await tx.query(`select * from invoices where id = $1 for update`, [invoiceId]))[0];
        if (!invoice || invoice.status === 'paid' || invoice.first_declined_at === null)
            return;
        if (!['past_due', 'retry_1', 'retry_2'].includes(invoice.dunning_state))
            return;
        const states = ['past_due', 'retry_1', 'retry_2'];
        const expected = states[retryIndex] ?? null;
        if (invoice.dunning_state !== expected)
            return;
        const owner = (await tx.query(`select * from users where id = $1`, [invoice.owner_id]))[0];
        const outcome = cardOutcome(owner.card_token ?? '');
        if (!outcome.approved) {
            const next = states[retryIndex + 1] ?? 'blocked';
            await tx.query(`update invoices set dunning_state = $2 where id = $1`, [invoiceId, next]);
            await audit(tx, systemActor(), next, 'dunning', invoiceId, expected, next, 'system');
            await enqueueDunningEmail(tx, invoiceId, next);
            return;
        }
        await recordInvoicePayment(tx, invoiceId, invoice.balance_cents, owner.card_token, outcome.last4);
    });
}
export async function recordInvoicePayment(tx, invoiceId, amountCents, cardToken, last4) {
    const invoice = (await tx.query(`select * from invoices where id = $1 for update`, [invoiceId]))[0];
    const paymentId = newId('pay');
    const t = now();
    const outcome = cardOutcome(cardToken ?? '');
    if (!outcome.approved) {
        await tx.query(`insert into payments(id, kind, status, owner_id, invoice_id, amount_cents, captured_cents, card_last4, decline_code, killbill_status, created_at, updated_at)
       values($1,'invoice','declined',$2,$3,$4,0,$5,$6,'not_recorded',$7,$7)`, [paymentId, invoice.owner_id, invoiceId, amountCents, last4, outcome.declineCode ?? '', t]);
        await audit(tx, systemActor(), 'authorise', 'payment', paymentId, null, 'declined', 'system');
        throw new AppError(402, 'card_declined', { decline_code: outcome.declineCode ?? 'unknown_card' });
    }
    await tx.query(`insert into payments(id, kind, status, owner_id, invoice_id, amount_cents, captured_cents, card_last4, killbill_status, created_at, updated_at)
     values($1,'invoice','captured',$2,$3,$4,$4,$5,'pending',$6,$6)`, [paymentId, invoice.owner_id, invoiceId, amountCents, last4, t]);
    await ledgerEntry(tx, 'invoice_payment', amountCents, t, invoice.owner_id, invoice.horse_id, invoice.business_date, invoiceId, paymentId);
    await tx.query(`update invoices set balance_cents = 0, status = 'paid', dunning_state = case when dunning_state <> 'none' then 'cleared' else dunning_state end where id = $1`, [invoiceId]);
    await audit(tx, systemActor(), 'capture', 'payment', paymentId, null, 'captured', 'system');
    await audit(tx, systemActor(), 'paid', 'invoice', invoiceId, invoice.status, 'paid', 'system');
    return (await tx.query(`select * from payments where id = $1`, [paymentId]))[0];
}
