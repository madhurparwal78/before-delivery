// Studio: staff sign-in, search, record views, packing and notices.
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { money } from '../shared/money.js';
import { torontoDate } from '../shared/toronto.js';
import { allow, requireStaff } from './auth.js';
import { packingCutoff } from './batches.js';
import { email, object, read, text } from './body.js';
import { pool, tx } from './db.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { endSession, immutable, route, startSession } from './http.js';
import { barKey, loadOrder, orderJson, refundedBars } from './orders.js';
import { listNotices, noticeJson, noticeStatus, resend } from './outbox.js';
import { findSubscription, subscriptionJson } from './subscriptions.js';
const signInBody = object({ email: email(), password: text((m) => m.fields.password, 1, 200) });
function passwordMatches(password, stored) {
    const [salt, hash] = stored.split(':');
    const given = scryptSync(password, salt, 32);
    return timingSafeEqual(given, Buffer.from(hash, 'hex'));
}
const DUMMY_HASH = `00000000000000000000000000000000:${'0'.repeat(64)}`;
route('POST', '/api/staff/sign-in', async (ctx) => {
    const body = read(signInBody, ctx.body, ctx.m);
    const staff = (await pool.query('SELECT * FROM staff WHERE email = $1', [body.email])).rows[0];
    const ok = passwordMatches(body.password, staff?.password_hash ?? DUMMY_HASH) && staff !== undefined;
    if (!ok || !staff)
        throw new ApiError(401, 'invalid_credentials', ctx.m.invalidCredentials);
    startSession(ctx, 'staff', staff.id);
    return { status: 200, body: { staff: { email: staff.email, name: staff.name, role: staff.role } } };
});
route('POST', '/api/staff/sign-out', async (ctx) => {
    read(object({}), ctx.body, ctx.m);
    endSession(ctx, 'staff');
    return { status: 204 };
});
route('GET', '/api/staff/me', async (ctx) => {
    const staff = await requireStaff(ctx);
    return { status: 200, body: { staff: { email: staff.email, name: staff.name, role: staff.role } } };
});
route('GET', '/api/staff/search', async (ctx) => {
    allow(ctx, await requireStaff(ctx), 'money');
    const q = (ctx.query.get('q') ?? '').trim();
    if (!q || /[\u0000-\u001f\u007f]/.test(q))
        throw invalid(ctx.m, { q: ctx.m.fields.q });
    const term = q.toUpperCase();
    const owner = /^(PDL|SUB)-\d{6}$/.test(term) ? null : q.toLowerCase();
    const orders = (await pool.query(`SELECT o.number, o.placed_at, o.total_cents, o.status FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.number = $1 OR c.email = $2 ORDER BY o.placed_at DESC`, [term, owner])).rows;
    const subscriptions = (await pool.query(`SELECT s.number, s.state, s.scent, s.cadence, s.next_bill_date FROM subscriptions s JOIN customers c ON c.id = s.customer_id
     WHERE s.number = $1 OR c.email = $2 ORDER BY s.created_at DESC`, [term, owner])).rows;
    return {
        status: 200,
        body: {
            orders: orders.map((o) => ({ number: o.number, placed_at: o.placed_at.toISOString(), total: money(o.total_cents), status: o.status })),
            subscriptions,
        },
    };
});
export const refundJson = (r) => ({
    number: r.number,
    order: r.order_number,
    status: r.status,
    bars: r.bars,
    restock: r.restock,
    amount: money(r.amount_cents),
    allocation: { bars: money(r.allocation.bars), shipping: money(r.allocation.shipping), taxes: r.allocation.taxes },
    reason: r.reason,
    killbill_ref: r.killbill_ref,
    created_at: r.created_at.toISOString(),
});
export const creditJson = (c) => ({
    number: c.number,
    target: c.target,
    status: c.status,
    amount: money(c.amount_cents),
    reason: c.reason,
    killbill_ref: c.killbill_ref,
    created_at: c.created_at.toISOString(),
});
const creditsFor = (target) => pool.query('SELECT * FROM credits WHERE target = $1 ORDER BY created_at, number', [target]).then((r) => r.rows);
async function staffOrder(number) {
    const loaded = (await loadOrder(pool, number));
    return { ...orderJson(loaded), refunds: loaded.refunds.map(refundJson), credits: (await creditsFor(number)).map(creditJson) };
}
route('GET', '/api/staff/orders/{number}', async (ctx) => {
    const staff = await requireStaff(ctx);
    const number = ctx.params.number ?? '';
    if (!((await pool.query('SELECT 1 FROM orders WHERE number = $1', [number])).rows[0]))
        throw notFound(ctx.m);
    allow(ctx, staff, 'money');
    const body = await staffOrder(number);
    return { status: 200, body, headers: { ETag: `"${body.version}"` } };
});
route('GET', '/api/staff/subscriptions/{number}', async (ctx) => {
    const staff = await requireStaff(ctx);
    const sub = await findSubscription(pool, ctx.params.number ?? '');
    if (!sub)
        throw notFound(ctx.m);
    allow(ctx, staff, 'money');
    const owner = (await pool.query('SELECT email FROM customers WHERE id = $1', [sub.customer_id])).rows[0];
    const body = { ...subscriptionJson(sub, ctx.now), email: owner?.email, credits: (await creditsFor(sub.number)).map(creditJson) };
    return { status: 200, body, headers: { ETag: `"${sub.version}"` } };
});
function packingOrder(loaded) {
    const done = refundedBars(loaded.refunds);
    const { order } = loaded;
    return {
        number: order.number,
        ship_on: order.ship_on,
        name: order.shipping.name,
        address: { line1: order.shipping.line1, city: order.shipping.city, province: order.shipping.province, postal_code: order.shipping.postal_code },
        bars: loaded.lines.filter((l) => !done.has(barKey(l.batch_code, l.bar))).map((l) => ({ batch: l.batch_code, scent: l.scent, bar: l.bar })),
        fulfilment: order.fulfilment,
        version: order.version,
    };
}
route('GET', '/api/staff/packing', async (ctx) => {
    allow(ctx, await requireStaff(ctx), 'packing');
    const today = torontoDate(ctx.now);
    const numbers = (await pool.query(`SELECT number FROM orders WHERE fulfilment = 'to_pack' AND status <> 'refunded' AND ship_on <= $1 ORDER BY ship_on, number`, [today])).rows;
    const orders = [];
    for (const { number } of numbers)
        orders.push(packingOrder((await loadOrder(pool, number))));
    return { status: 200, body: { date: today, cutoff_local: await packingCutoff(pool), orders } };
});
const shipBody = object({});
route('POST', '/api/staff/orders/{number}/ship', async (ctx) => {
    const staff = await requireStaff(ctx);
    const number = ctx.params.number ?? '';
    const shipped = await tx(async (db) => {
        const loaded = await loadOrder(db, number, true);
        if (!loaded)
            throw notFound(ctx.m);
        allow(ctx, staff, 'packing');
        if (loaded.order.fulfilment === 'shipped')
            throw conflict('already_shipped', ctx.m.already_shipped(number));
        if (loaded.order.status === 'refunded')
            throw conflict('order_refunded', ctx.m.order_refunded(number));
        read(shipBody, ctx.body, ctx.m);
        await db.query(`UPDATE orders SET fulfilment = 'shipped', version = version + 1 WHERE number = $1`, [number]);
        return (await loadOrder(db, number));
    });
    return { status: 200, body: { order: packingOrder(shipped) } };
});
const STATUSES = ['queued', 'retrying', 'sent', 'failed'];
route('GET', '/api/staff/notices', async (ctx) => {
    allow(ctx, await requireStaff(ctx), 'books');
    const status = ctx.query.get('status');
    if (status !== null && !STATUSES.includes(status))
        throw invalid(ctx.m, { status: ctx.m.fields.status });
    return { status: 200, body: { notices: await listNotices(status) } };
});
route('POST', '/api/staff/notices/{number}/resend', async (ctx) => {
    const staff = await requireStaff(ctx);
    const number = ctx.params.number ?? '';
    const status = await noticeStatus(number);
    if (!status)
        throw notFound(ctx.m);
    allow(ctx, staff, 'books');
    if (status !== 'failed')
        throw conflict('notice_not_failed', ctx.m.notice_not_failed(number));
    read(object({}), ctx.body, ctx.m);
    const notice = await resend(number, ctx.now);
    if (!notice)
        throw conflict('notice_not_failed', ctx.m.notice_not_failed(number));
    return { status: 200, body: { notice: noticeJson(notice) } };
});
immutable('/api/staff/audit');
immutable('/api/staff/audit/{id}');
