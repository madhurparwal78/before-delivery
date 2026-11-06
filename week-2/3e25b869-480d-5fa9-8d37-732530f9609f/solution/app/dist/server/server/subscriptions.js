import { CADENCE_MONTHS, CADENCES, CORE_SCENTS } from '../shared/catalog.js';
import { centsFromDecimal, money, trioPrice } from '../shared/money.js';
import { addMonths, longDate, torontoDate, torontoMidnight } from '../shared/toronto.js';
import { requireCustomer } from './auth.js';
import { object, oneOf, optional, read, shippingAddress } from './body.js';
import { customerAccount } from './checkout.js';
import { config } from './config.js';
import { pool, takeSequenceNumber, tx } from './db.js';
import { subscriptionNotice } from './emails.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { route } from './http.js';
import { idempotent } from './idempotency.js';
import * as kb from './killbill.js';
import { drain, enqueue } from './outbox.js';
/** The first date of the bill-date series (anchored on `anchor`, stepping by `cadence`) strictly after `after`. */
function nextBillAfter(anchor, cadence, after) {
    const day = Number(anchor.slice(8, 10));
    for (let step = 1;; step += 1) {
        const date = addMonths(anchor, step * CADENCE_MONTHS[cadence], day);
        if (date > after)
            return date;
    }
}
/** A bill date locks SUBSCRIPTION_LOCK_HOURS elapsed hours before its 00:00 Toronto. */
function locksAt(billDate) {
    return new Date(torontoMidnight(billDate).getTime() - config.subscriptionLockHours * 3_600_000);
}
const isLocked = (billDate, now) => now >= locksAt(billDate);
export function subscriptionJson(sub, now) {
    const lock = sub.next_bill_date ? locksAt(sub.next_bill_date) : null;
    return {
        number: sub.number,
        state: sub.state,
        scent: sub.scent,
        cadence: sub.cadence,
        pending_cadence: sub.pending_cadence,
        started_on: sub.started_on,
        next_bill_date: sub.next_bill_date,
        skipped_bill_date: sub.skipped_bill_date,
        paused_from: sub.paused_from,
        locks_at: lock ? lock.toISOString() : null,
        locked: sub.next_bill_date ? isLocked(sub.next_bill_date, now) : false,
        shipping: sub.shipping,
        price: trioPrice(sub.shipping.province),
        version: sub.version,
    };
}
export async function findSubscription(db, number, lock = false) {
    return db.query(`SELECT * FROM subscriptions WHERE number = $1${lock ? ' FOR UPDATE' : ''}`, [number]).then((r) => r.rows[0]);
}
const billingDown = (ctx) => new ApiError(503, 'billing_unavailable', ctx.m.bannerSubscriptions);
/** Commits a subscription's draft invoice with its tax items and pays the rest, keyed `<sub>-<date>`. */
async function billDraft(db, sub, accountId, date) {
    const draft = await kb.draftInvoiceFor(accountId, sub.kb_subscription_id);
    if (!draft)
        throw new kb.BillingUnavailable(`no draft invoice for ${sub.number}`);
    const price = trioPrice(sub.shipping.province);
    const committed = await kb.finishInvoice(accountId, draft.invoiceId, price.taxes.map((t) => ({ code: t.code, cents: t.amount.cents })));
    const charged = centsFromDecimal(committed.balance);
    const key = `${sub.number}-${date}`;
    const paymentId = charged > 0 ? await kb.payInvoice(accountId, committed.invoiceId, charged, key) : null;
    await db.query(`INSERT INTO subscription_charges (payment_key, subscription, bill_date, kb_invoice_id, kb_payment_id, total_cents)
     VALUES ($1,$2,$3,$4,$5,$6)`, [key, sub.number, date, committed.invoiceId, paymentId, price.total.cents]);
    return { total: price.total.cents, charged };
}
const startBody = object({
    scent: oneOf(CORE_SCENTS.map((s) => s.slug), (m) => m.fields.scent),
    cadence: oneOf(CADENCES, (m) => m.fields.cadence),
    shipping: shippingAddress,
});
const CUSTOMER_LOCK = 7340200;
route('POST', '/api/subscriptions', async (ctx) => {
    const customer = await requireCustomer(ctx);
    return idempotent(ctx, `subscribe:${customer.id}`, async () => {
        const reply = await tx(async (db) => {
            await db.query('SELECT pg_advisory_xact_lock($1, $2)', [CUSTOMER_LOCK, customer.id]);
            const existing = (await db.query(`SELECT 1 FROM subscriptions WHERE customer_id = $1 AND state IN ('active','paused')`, [customer.id])).rows[0];
            if (existing)
                throw conflict('subscription_exists', ctx.m.subscription_exists);
            const body = read(startBody, ctx.body, ctx.m);
            const number = await takeSequenceNumber('SUB');
            const startedOn = torontoDate(ctx.now);
            const nextBill = nextBillAfter(startedOn, body.cadence, startedOn);
            let billed;
            let kbSubscriptionId;
            try {
                const accountId = await customerAccount(customer, body.shipping);
                kbSubscriptionId = await kb.createSubscription(accountId, body.cadence, number);
                await db.query(`INSERT INTO subscriptions (number, customer_id, state, scent, cadence, started_on, anchor_date, next_bill_date, shipping,
             locale, version, kb_subscription_id)
           VALUES ($1,$2,'active',$3,$4,$5,$5,$6,$7,$8,1,$9)`, [number, customer.id, body.scent, body.cadence, startedOn, nextBill, JSON.stringify(body.shipping), ctx.locale, kbSubscriptionId]);
                const sub = (await findSubscription(db, number));
                billed = await billDraft(db, sub, accountId, startedOn);
            }
            catch (error) {
                if (error instanceof kb.BillingUnavailable)
                    throw billingDown(ctx);
                throw error;
            }
            const sub = (await findSubscription(db, number));
            const price = trioPrice(body.shipping.province);
            await enqueue(db, subscriptionNotice({
                number,
                email: customer.email,
                locale: ctx.locale,
                scent: body.scent,
                cadence: body.cadence,
                subtotal: price.subtotal.cents,
                discount: price.discount.cents,
                taxes: price.taxes,
                total: price.total.cents,
                chargedToday: billed.charged,
                nextBillDate: nextBill,
            }), ctx.now);
            return {
                status: 201,
                body: {
                    subscription: subscriptionJson(sub, ctx.now),
                    charged_today: money(billed.charged),
                    credit_applied: money(billed.total - billed.charged),
                },
            };
        });
        void drain();
        return reply;
    });
});
async function ownSubscription(ctx, db, customer, lock) {
    const sub = await findSubscription(db, ctx.params.number ?? '', lock);
    if (!sub || sub.customer_id !== customer.id)
        throw notFound(ctx.m);
    return sub;
}
route('GET', '/api/account/subscriptions/{number}', async (ctx) => {
    const customer = await requireCustomer(ctx);
    return { status: 200, body: subscriptionJson(await ownSubscription(ctx, pool, customer, false), ctx.now) };
});
const invalidTransition = (ctx) => conflict('invalid_transition', ctx.m.invalid_transition_sub);
const cycleLocked = (ctx, billDate) => conflict('cycle_locked', ctx.m.cycle_locked(longDate(billDate, ctx.locale)));
function guardLock(ctx, billDate) {
    if (billDate && isLocked(billDate, ctx.now))
        throw cycleLocked(ctx, billDate);
}
const changes = {
    skip: {
        guard(ctx, sub) {
            if (sub.state !== 'active')
                throw invalidTransition(ctx);
            guardLock(ctx, sub.next_bill_date);
            if (sub.skipped_bill_date)
                throw conflict('already_skipped', ctx.m.alreadySkipped);
        },
        async apply(_ctx, _db, sub) {
            const skipped = sub.next_bill_date;
            const next = nextBillAfter(sub.anchor_date, sub.cadence, skipped);
            await kb.block(sub.kb_subscription_id, 'TRIO_SKIP', torontoMidnight(skipped));
            await kb.block(sub.kb_subscription_id, 'TRIO_CLEAR', torontoMidnight(next));
            return { skipped_bill_date: skipped, next_bill_date: next };
        },
    },
    unskip: {
        guard(ctx, sub) {
            if (sub.state !== 'active')
                throw invalidTransition(ctx);
            if (!sub.skipped_bill_date)
                throw conflict('not_skipped', ctx.m.notSkipped);
            guardLock(ctx, sub.skipped_bill_date);
        },
        async apply(_ctx, _db, sub) {
            const skipped = sub.skipped_bill_date;
            await kb.block(sub.kb_subscription_id, 'TRIO_CLEAR', torontoMidnight(skipped));
            return { skipped_bill_date: null, next_bill_date: skipped };
        },
    },
    pause: {
        guard(ctx, sub) {
            if (sub.state !== 'active' || sub.skipped_bill_date)
                throw invalidTransition(ctx);
            guardLock(ctx, sub.next_bill_date);
        },
        async apply(_ctx, _db, sub) {
            const from = sub.next_bill_date;
            await kb.block(sub.kb_subscription_id, 'TRIO_PAUSE', torontoMidnight(from));
            return { state: 'paused', paused_from: from, next_bill_date: null };
        },
    },
    resume: {
        guard(ctx, sub) {
            if (sub.state !== 'paused')
                throw invalidTransition(ctx);
        },
        async apply(ctx, db, sub, customer) {
            const from = sub.paused_from;
            const today = torontoDate(ctx.now);
            if (today < from) {
                await kb.block(sub.kb_subscription_id, 'TRIO_CLEAR', torontoMidnight(from));
                return { state: 'active', paused_from: null, next_bill_date: from };
            }
            await kb.block(sub.kb_subscription_id, 'TRIO_CLEAR', ctx.now);
            await billDraft(db, sub, customer.kb_account_id, today);
            return { state: 'active', paused_from: null, anchor_date: today, next_bill_date: nextBillAfter(today, sub.cadence, today) };
        },
    },
    cancel: {
        guard(ctx, sub) {
            if (sub.state !== 'active')
                throw invalidTransition(ctx);
            guardLock(ctx, sub.next_bill_date);
        },
        async apply(_ctx, _db, sub) {
            await kb.cancel(sub.kb_subscription_id, sub.next_bill_date);
            return { state: 'cancelled', next_bill_date: null, skipped_bill_date: null, pending_cadence: null };
        },
    },
};
const UPDATABLE = ['state', 'cadence', 'pending_cadence', 'scent', 'anchor_date', 'next_bill_date', 'skipped_bill_date', 'paused_from'];
async function update(db, number, columns) {
    const names = UPDATABLE.filter((name) => name in columns);
    const sets = names.map((name, i) => `${name} = $${i + 2}`);
    const values = names.map((name) => columns[name]);
    const updated = await db.query(`UPDATE subscriptions SET ${[...sets, 'version = version + 1'].join(', ')} WHERE number = $1 RETURNING *`, [number, ...values]);
    return updated.rows[0];
}
const emptyBody = object({});
for (const [action, change] of Object.entries(changes)) {
    route('POST', `/api/account/subscriptions/{number}/${action}`, async (ctx) => {
        const customer = await requireCustomer(ctx);
        const sub = await tx(async (db) => {
            const current = await ownSubscription(ctx, db, customer, true);
            change.guard(ctx, current);
            read(emptyBody, ctx.body, ctx.m);
            try {
                return await update(db, current.number, await change.apply(ctx, db, current, customer));
            }
            catch (error) {
                if (error instanceof kb.BillingUnavailable)
                    throw billingDown(ctx);
                throw error;
            }
        });
        return { status: 200, body: { subscription: subscriptionJson(sub, ctx.now) } };
    });
}
const patchBody = object({
    scent: optional(oneOf(CORE_SCENTS.map((s) => s.slug), (m) => m.fields.scent)),
    cadence: optional(oneOf(CADENCES, (m) => m.fields.cadence)),
});
route('PATCH', '/api/account/subscriptions/{number}', async (ctx) => {
    const customer = await requireCustomer(ctx);
    const sub = await tx(async (db) => {
        const current = await ownSubscription(ctx, db, customer, true);
        if (current.state !== 'active')
            throw invalidTransition(ctx);
        guardLock(ctx, current.next_bill_date);
        const body = read(patchBody, ctx.body, ctx.m);
        if (body.scent === undefined && body.cadence === undefined)
            throw invalid(ctx.m, { scent: ctx.m.fields.scent });
        if (body.cadence === current.cadence)
            throw invalid(ctx.m, { cadence: ctx.m.fields.cadenceSame });
        const columns = {};
        if (body.scent !== undefined)
            columns.scent = body.scent;
        if (body.cadence !== undefined) {
            try {
                await kb.changePlan(current.kb_subscription_id, body.cadence, current.next_bill_date, current.pending_cadence !== null);
            }
            catch (error) {
                if (error instanceof kb.BillingUnavailable)
                    throw billingDown(ctx);
                throw error;
            }
            columns.pending_cadence = body.cadence;
        }
        return update(db, current.number, columns);
    });
    return { status: 200, body: { subscription: subscriptionJson(sub, ctx.now) } };
});
const RENEWAL_LOCK = 7340003;
/** Bills every active Trio whose bill date has come, one subscription per transaction, applying a pending cadence. */
async function renew() {
    const today = torontoDate(new Date());
    await pool.query(`UPDATE subscriptions SET skipped_bill_date = NULL WHERE skipped_bill_date <= $1`, [today]);
    const due = (await pool.query(`SELECT number FROM subscriptions WHERE state = 'active' AND next_bill_date <= $1`, [today])).rows;
    for (const { number } of due) {
        await tx(async (db) => {
            const lock = (await db.query('SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS ok', [RENEWAL_LOCK, number])).rows[0];
            const sub = lock?.ok ? await findSubscription(db, number, true) : undefined;
            if (!sub || sub.state !== 'active' || !sub.next_bill_date || sub.next_bill_date > today)
                return;
            const account = (await db.query('SELECT kb_account_id FROM customers WHERE id = $1', [sub.customer_id])).rows[0];
            const billDate = sub.next_bill_date;
            const cadence = sub.pending_cadence ?? sub.cadence;
            const anchor = sub.pending_cadence ? billDate : sub.anchor_date;
            await billDraft(db, sub, account?.kb_account_id, billDate);
            await update(db, sub.number, { cadence, pending_cadence: null, anchor_date: anchor, next_bill_date: nextBillAfter(anchor, cadence, billDate) });
        }).catch((error) => console.error(`renewal ${number}: ${error.message}`));
    }
}
export function startRenewals() {
    setInterval(() => void renew(), 60_000).unref();
}
