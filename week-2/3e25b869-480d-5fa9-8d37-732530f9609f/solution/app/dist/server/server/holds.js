// Holds and the cart: the lowest available bar, two per batch per cart, ending on the server's clock.
import { randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_PROVINCE, province } from '../shared/catalog.js';
import { BAR_CENTS, dropTotals, money } from '../shared/money.js';
import { object, read, text } from './body.js';
import { findBatch, isPublic, openDueBatches } from './batches.js';
import { config } from './config.js';
import { pool, tx } from './db.js';
import { conflict, invalid, notFound } from './errors.js';
import { cookie, route } from './http.js';
import { ACTIVE_HOLD, HOLD_STATUS, stockOf } from './stock.js';
const HOLDS_PER_BATCH = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Selects holds with their status as of `now` (parameter `$n`). */
export const HOLD_COLUMNS = (n) => `h.id, h.cart_id, h.batch_code, h.bar, ${HOLD_STATUS('h', `$${n}`)} AS status, h.created_at, h.expires_at`;
const holdJson = (hold) => ({
    id: hold.id,
    batch: hold.batch_code,
    bar: hold.bar,
    status: hold.status,
    created_at: hold.created_at.toISOString(),
    expires_at: hold.expires_at.toISOString(),
    amount: money(BAR_CENTS),
});
export const isUuid = (value) => typeof value === 'string' && UUID.test(value);
/** Marks holds past their edge as expired, so stored rows match what every read already derives. */
export async function expireHolds(db, now) {
    await db.query(`UPDATE holds h SET status = 'expired' WHERE h.status = 'active' AND NOT (${ACTIVE_HOLD('h', '$1')})`, [now]);
}
async function cartJson(db, cartId, provinceCode, now) {
    const holds = cartId
        ? (await db.query(`SELECT * FROM holds h WHERE h.cart_id = $1 AND ${ACTIVE_HOLD('h', '$2')} ORDER BY h.created_at, h.bar`, [cartId, now])).rows
        : [];
    const codes = [...new Set(holds.map((h) => h.batch_code))];
    const stock = await stockOf(db, codes, now);
    return {
        server_now: now.toISOString(),
        holds: holds.map(holdJson),
        batches: codes.map((code) => {
            const s = stock.get(code);
            return { code, available: s.available, held: s.held, sold: s.sold };
        }),
        province: provinceCode,
        ...dropTotals(holds.length, provinceCode),
    };
}
const holdBody = object({ batch: text((m) => m.fields.batch, 1, 20) });
route('POST', '/api/holds', async (ctx) => {
    const raw = ctx.body;
    if (typeof raw?.batch !== 'string')
        read(holdBody, ctx.body, ctx.m);
    const code = String(raw?.batch);
    let cartId = ctx.cookies.pdl_cart;
    const hold = await tx(async (db) => {
        await openDueBatches(db, ctx.now);
        const batch = await findBatch(db, code, true);
        if (!batch || !isPublic(batch))
            throw notFound(ctx.m);
        if (batch.state === 'scheduled')
            throw conflict('not_live', ctx.m.not_live);
        if (batch.state === 'sold_out')
            throw conflict('sold_out', ctx.m.sold_out);
        const stock = (await stockOf(db, [code], ctx.now)).get(code);
        const mine = cartId
            ? (await db.query(`SELECT 1 FROM holds h WHERE h.cart_id = $1 AND h.batch_code = $2 AND ${ACTIVE_HOLD('h', '$3')}`, [cartId, code, ctx.now])).rows
            : [];
        if (mine.length >= HOLDS_PER_BATCH)
            throw conflict('hold_limit', ctx.m.hold_limit);
        const bar = stock.bars.find((b) => b.status === 'available');
        if (!bar)
            throw stock.held > 0 ? conflict('all_held', ctx.m.all_held) : conflict('sold_out', ctx.m.sold_out);
        read(holdBody, ctx.body, ctx.m);
        cartId ??= randomBytes(18).toString('base64url');
        const created = await db.query(`INSERT INTO holds (id, cart_id, batch_code, bar, status, created_at, expires_at) VALUES ($1,$2,$3,$4,'active',$5,$6) RETURNING *`, [randomUUID(), cartId, code, bar.number, ctx.now, new Date(ctx.now.getTime() + config.holdTtlSeconds * 1000)]);
        return created.rows[0];
    });
    if (!ctx.cookies.pdl_cart)
        ctx.outCookies.push(cookie('pdl_cart', hold.cart_id, 30 * 24 * 3600));
    return { status: 201, body: { hold: holdJson(hold), cart: await cartJson(pool, hold.cart_id, DEFAULT_PROVINCE, ctx.now) } };
});
const releaseBody = object({});
route('DELETE', '/api/holds/{id}', async (ctx) => {
    const id = ctx.params.id;
    const cartId = ctx.cookies.pdl_cart;
    const released = await tx(async (db) => {
        const found = isUuid(id) && cartId
            ? (await db.query(`SELECT ${HOLD_COLUMNS(3)} FROM holds h WHERE h.id = $1 AND h.cart_id = $2 FOR UPDATE`, [id, cartId, ctx.now])).rows
            : [];
        const hold = found[0];
        if (!hold)
            throw notFound(ctx.m);
        if (hold.status !== 'active')
            throw conflict('hold_not_active', ctx.m.holdNotActive);
        read(releaseBody, ctx.body, ctx.m);
        const updated = await db.query(`UPDATE holds SET status = 'released' WHERE id = $1 RETURNING *`, [id]);
        return updated.rows[0];
    });
    return { status: 200, body: { hold: holdJson(released) } };
});
route('GET', '/api/cart', async (ctx) => {
    const code = ctx.query.get('province') ?? DEFAULT_PROVINCE;
    if (!province(code))
        throw invalid(ctx.m, { province: ctx.m.fields.province });
    return { status: 200, body: await cartJson(pool, ctx.cookies.pdl_cart, code, ctx.now) };
});
