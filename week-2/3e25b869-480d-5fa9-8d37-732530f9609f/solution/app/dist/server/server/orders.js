import { money } from '../shared/money.js';
import { addDays, torontoDate, wallClock, weekday } from '../shared/toronto.js';
export async function loadOrder(db, number, lock = false) {
    const order = (await db.query(`SELECT * FROM orders WHERE number = $1${lock ? ' FOR UPDATE' : ''}`, [number])).rows[0];
    if (!order)
        return undefined;
    const lines = (await db.query(`SELECT l.batch_code, l.bar, l.unit_cents, b.scent FROM order_lines l JOIN batches b ON b.code = l.batch_code
     WHERE l.order_number = $1 ORDER BY l.batch_code, l.bar`, [number])).rows;
    const refunds = (await db.query('SELECT * FROM refunds WHERE order_number = $1 ORDER BY created_at, number', [number])).rows;
    return { order, lines, refunds };
}
export const barKey = (batch, bar) => `${batch}:${bar}`;
/** Bars covered by an issued refund. */
export const refundedBars = (refunds) => new Set(refunds.filter((r) => r.status === 'issued').flatMap((r) => r.bars.map((b) => barKey(b.batch, b.bar))));
const refundedCents = (refunds) => refunds.filter((r) => r.status === 'issued').reduce((sum, r) => sum + r.amount_cents, 0);
export function orderJson({ order, lines, refunds }) {
    const done = refundedBars(refunds);
    return {
        number: order.number,
        status: order.status,
        fulfilment: order.fulfilment,
        placed_at: order.placed_at.toISOString(),
        ship_on: order.ship_on,
        locale: order.locale,
        email: order.email,
        shipping: order.shipping,
        lines: lines.map((l) => ({
            batch: l.batch_code,
            scent: l.scent,
            bar: l.bar,
            unit_price: money(l.unit_cents),
            refunded: done.has(barKey(l.batch_code, l.bar)),
        })),
        subtotal: money(order.subtotal_cents),
        shipping_fee: money(order.shipping_cents),
        taxes: order.taxes,
        total: money(order.total_cents),
        refunded: money(refundedCents(refunds)),
        version: order.version,
    };
}
/** The ship date: the paid instant's Toronto date if it is a weekday before the cutoff, else the next weekday. */
export function shipOn(placedAt, cutoff) {
    const today = torontoDate(placedAt);
    const clock = wallClock(placedAt);
    const [hh, mm] = cutoff.split(':').map(Number);
    const weekdayToday = weekday(today) >= 1 && weekday(today) <= 5;
    if (weekdayToday && clock.hour * 60 + clock.minute < hh * 60 + mm)
        return today;
    let day = addDays(today, 1);
    while (weekday(day) === 0 || weekday(day) === 6)
        day = addDays(day, 1);
    return day;
}
