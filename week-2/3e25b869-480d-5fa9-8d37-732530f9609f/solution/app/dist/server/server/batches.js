import { BATCH_STATE_LABELS, DROP_SCENTS, pick } from '../shared/catalog.js';
import { addDays, longDate, TIME_ZONE, torontoDate, torontoInstant } from '../shared/toronto.js';
import { allow, requireStaff } from './auth.js';
import { integer, object, oneOf, read, text } from './body.js';
import { pool, tx } from './db.js';
import { conflict, invalid, notFound } from './errors.js';
import { route } from './http.js';
import { ACTIVE_HOLD, cureDate, publicBatch, stockOf } from './stock.js';
/** The manual transitions: the states each action may start from. */
const ALLOWED_FROM = {
    cut: ['poured'],
    schedule: ['curing', 'scheduled'],
    open: ['curing', 'scheduled'],
    withdraw: ['poured', 'curing', 'scheduled', 'live'],
};
const PUBLIC_STATES = ['scheduled', 'live', 'sold_out'];
function guardTransition(ctx, batch, action) {
    if (!ALLOWED_FROM[action].includes(batch.state)) {
        const state = pick(BATCH_STATE_LABELS[batch.state], ctx.locale).toLowerCase();
        throw conflict('invalid_transition', ctx.m.batchTransition(state, action));
    }
}
/** The automatic transitions: scheduled → live at drop_at (inclusive). */
export async function openDueBatches(db, now) {
    await db.query(`UPDATE batches SET state = 'live' WHERE state = 'scheduled' AND drop_at <= $1`, [now]);
}
/** The automatic transitions: live → sold_out when sold equals cut, sold_out → live when a bar comes back. */
export async function settleSoldOut(db, code, now) {
    const stock = (await stockOf(db, [code], now)).get(code);
    const soldOut = stock.sold === stock.bars_cut;
    await db.query(`UPDATE batches SET state = $2 WHERE code = $1 AND state = $3`, [
        code,
        soldOut ? 'sold_out' : 'live',
        soldOut ? 'live' : 'sold_out',
    ]);
}
const BATCH_COLUMNS = 'code, scent, poured_on, cure_days, state, drop_at';
export async function findBatch(db, code, lock = false) {
    return db.query(`SELECT ${BATCH_COLUMNS} FROM batches WHERE code = $1${lock ? ' FOR UPDATE' : ''}`, [code]).then((r) => r.rows[0]);
}
export const isPublic = (batch) => PUBLIC_STATES.includes(batch.state);
async function staffBatch(db, code, now) {
    const batch = (await findBatch(db, code));
    const stock = (await stockOf(db, [code], now)).get(code);
    return staffJson(batch, stock);
}
function staffJson(batch, stock) {
    return {
        ...publicBatch(batch, stock),
        poured_on: batch.poured_on,
        cure_days: batch.cure_days,
        holds: stock.holds.map((h) => ({ bar: h.bar, expires_at: h.expires_at.toISOString() })),
    };
}
route('GET', '/api/drop', async (ctx) => {
    await openDueBatches(pool, ctx.now);
    const batches = (await pool.query(`SELECT ${BATCH_COLUMNS} FROM batches WHERE state = ANY($1) ORDER BY drop_at NULLS LAST, code`, [PUBLIC_STATES])).rows;
    const stock = await stockOf(pool, batches.map((b) => b.code), ctx.now);
    return {
        status: 200,
        body: { server_now: ctx.now.toISOString(), batches: batches.map((b) => publicBatch(b, stock.get(b.code))) },
    };
});
route('GET', '/api/batches/{code}', async (ctx) => {
    await openDueBatches(pool, ctx.now);
    const batch = await findBatch(pool, ctx.params.code ?? '');
    if (!batch || !isPublic(batch))
        throw notFound(ctx.m);
    const stock = await stockOf(pool, [batch.code], ctx.now);
    return { status: 200, body: publicBatch(batch, stock.get(batch.code)) };
});
route('GET', '/api/staff/batches', async (ctx) => {
    allow(ctx, await requireStaff(ctx), 'batches');
    await openDueBatches(pool, ctx.now);
    const batches = (await pool.query(`SELECT ${BATCH_COLUMNS} FROM batches ORDER BY code`)).rows;
    const stock = await stockOf(pool, batches.map((b) => b.code), ctx.now);
    return {
        status: 200,
        body: { server_now: ctx.now.toISOString(), batches: batches.map((b) => staffJson(b, stock.get(b.code))) },
    };
});
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value) => DATE.test(value) && addDays(value, 0) === value;
const logLoafBody = object({
    scent: oneOf(DROP_SCENTS.map((s) => s.slug), (m) => m.fields.scent),
    poured_on: text((m) => m.fields.poured_on, 10, 10),
    cure_days: integer(28, 60, (m) => m.fields.cure_days),
});
route('POST', '/api/staff/batches', async (ctx) => {
    allow(ctx, await requireStaff(ctx), 'batches');
    const body = read(logLoafBody, ctx.body, ctx.m);
    if (!validDate(body.poured_on) || body.poured_on > torontoDate(ctx.now))
        throw invalid(ctx.m, { poured_on: ctx.m.fields.poured_on });
    const code = await tx(async (db) => {
        const next = (await db.query("SELECT nextval('batch_code_seq') AS n")).rows[0];
        const batchCode = `B-${String(next?.n).padStart(4, '0')}`;
        await db.query(`INSERT INTO batches (code, scent, poured_on, cure_days, state) VALUES ($1,$2,$3,$4,'poured')`, [
            batchCode,
            body.scent,
            body.poured_on,
            body.cure_days,
        ]);
        return batchCode;
    });
    return { status: 201, body: { batch: await staffBatch(pool, code, ctx.now) } };
});
/** Runs a batch action: 404, then the role, then the state machine, then validation, under the batch's row lock. */
function batchAction(action, apply) {
    return async (ctx) => {
        const staff = await requireStaff(ctx);
        const code = ctx.params.code ?? '';
        await tx(async (db) => {
            await openDueBatches(db, ctx.now);
            const batch = await findBatch(db, code, true);
            if (!batch)
                throw notFound(ctx.m);
            allow(ctx, staff, 'batches');
            guardTransition(ctx, batch, action);
            await apply(ctx, db, batch);
        });
        return { status: 200, body: { batch: await staffBatch(pool, code, ctx.now) } };
    };
}
const cutBody = object({ bars: integer(1, 24, (m) => m.fields.cutBars) });
route('POST', '/api/staff/batches/{code}/cut', batchAction('cut', async (ctx, db, batch) => {
    const { bars } = read(cutBody, ctx.body, ctx.m);
    await db.query(`UPDATE batches SET state = 'curing' WHERE code = $1`, [batch.code]);
    await db.query(`INSERT INTO movements (batch_code, kind, bars, ref, at) VALUES ($1, 'cut', $2, NULL, $3)`, [
        batch.code,
        Array.from({ length: bars }, (_, i) => i + 1),
        ctx.now,
    ]);
}));
const LOCAL_MINUTE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const scheduleBody = object({ drop_at_local: text((m) => m.fields.dropFormat, 1, 40) });
route('POST', '/api/staff/batches/{code}/schedule', batchAction('schedule', async (ctx, db, batch) => {
    const { drop_at_local: local } = read(scheduleBody, ctx.body, ctx.m);
    const match = LOCAL_MINUTE.exec(local);
    const [hour, minute] = [Number(match?.[2]), Number(match?.[3])];
    if (!match || !validDate(match[1] ?? '') || hour > 23 || minute > 59) {
        throw invalid(ctx.m, { drop_at_local: ctx.m.fields.dropFormat });
    }
    const date = match[1];
    const at = torontoInstant(date, hour, minute);
    if (!at)
        throw invalid(ctx.m, { drop_at_local: ctx.m.fields.dropGap });
    if (at <= ctx.now)
        throw invalid(ctx.m, { drop_at_local: ctx.m.fields.dropPast });
    const cure = cureDate(batch);
    if (date < cure)
        throw invalid(ctx.m, { drop_at_local: ctx.m.fields.dropBeforeCure(longDate(cure, ctx.locale)) });
    await db.query(`UPDATE batches SET state = 'scheduled', drop_at = $2 WHERE code = $1`, [batch.code, at]);
}));
const emptyBody = object({});
route('POST', '/api/staff/batches/{code}/open', batchAction('open', async (ctx, db, batch) => {
    read(emptyBody, ctx.body, ctx.m);
    const cure = cureDate(batch);
    if (torontoDate(ctx.now) < cure)
        throw invalid(ctx.m, { drop_at_local: ctx.m.fields.notCured(longDate(cure, ctx.locale)) });
    await db.query(`UPDATE batches SET state = 'live', drop_at = $2 WHERE code = $1`, [batch.code, ctx.now]);
}));
route('POST', '/api/staff/batches/{code}/withdraw', batchAction('withdraw', async (ctx, db, batch) => {
    read(emptyBody, ctx.body, ctx.m);
    await db.query(`UPDATE holds h SET status = 'released' WHERE h.batch_code = $1 AND ${ACTIVE_HOLD('h', '$2')}`, [batch.code, ctx.now]);
    await db.query(`UPDATE batches SET state = 'withdrawn' WHERE code = $1`, [batch.code]);
}));
route('GET', '/api/staff/batches/{code}/movements', async (ctx) => {
    const staff = await requireStaff(ctx);
    const batch = await findBatch(pool, ctx.params.code ?? '');
    if (!batch)
        throw notFound(ctx.m);
    allow(ctx, staff, 'batches');
    const movements = (await pool.query('SELECT at, kind, bars, ref FROM movements WHERE batch_code = $1 ORDER BY id', [batch.code])).rows;
    return { status: 200, body: { movements: movements.map((mv) => ({ at: mv.at.toISOString(), kind: mv.kind, bars: mv.bars, ref: mv.ref })) } };
});
export async function packingCutoff(db) {
    const row = (await db.query('SELECT packing_cutoff_local FROM settings WHERE id = 1')).rows[0];
    return row?.packing_cutoff_local;
}
route('GET', '/api/staff/settings', async (ctx) => {
    allow(ctx, await requireStaff(ctx), 'batches');
    return { status: 200, body: { packing_cutoff_local: await packingCutoff(pool), time_zone: TIME_ZONE } };
});
const settingsBody = object({ packing_cutoff_local: text((m) => m.fields.packing_cutoff_local, 5, 5) });
route('PUT', '/api/staff/settings', async (ctx) => {
    allow(ctx, await requireStaff(ctx), 'batches');
    const { packing_cutoff_local: cutoff } = read(settingsBody, ctx.body, ctx.m);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff))
        throw invalid(ctx.m, { packing_cutoff_local: ctx.m.fields.packing_cutoff_local });
    await pool.query('UPDATE settings SET packing_cutoff_local = $1 WHERE id = 1', [cutoff]);
    return { status: 200, body: { packing_cutoff_local: cutoff, time_zone: TIME_ZONE } };
});
