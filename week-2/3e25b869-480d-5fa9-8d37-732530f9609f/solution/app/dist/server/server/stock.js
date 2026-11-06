import { BAR_CENTS, money } from '../shared/money.js';
import { addDays, localMinute } from '../shared/toronto.js';
/** A hold is active while the server's time is strictly before its expires_at. `now` is the request's instant parameter. */
export const ACTIVE_HOLD = (alias, now) => `${alias}.status = 'active' AND ${alias}.expires_at > ${now}`;
/** The hold's state at `now`: an active hold at or past its edge reads as expired. */
export const HOLD_STATUS = (alias, now) => `CASE WHEN ${alias}.status = 'active' AND NOT (${ACTIVE_HOLD(alias, now)}) THEN 'expired' ELSE ${alias}.status END`;
export const cureDate = (b) => addDays(b.poured_on, b.cure_days);
/** Counts and per-bar status for each batch code. */
export async function stockOf(db, codes, now) {
    const movements = (await db.query('SELECT batch_code, kind, bars FROM movements WHERE batch_code = ANY($1) ORDER BY id', [codes])).rows;
    const holds = (await db.query(`SELECT h.batch_code, h.bar, h.expires_at FROM holds h WHERE h.batch_code = ANY($1) AND ${ACTIVE_HOLD('h', '$2')} ORDER BY h.bar`, [codes, now])).rows;
    const out = new Map();
    for (const code of codes) {
        let cut = 0;
        const latest = new Map();
        for (const move of movements.filter((mv) => mv.batch_code === code)) {
            if (move.kind === 'cut')
                cut += move.bars.length;
            else
                for (const bar of move.bars)
                    latest.set(bar, move.kind);
        }
        const batchHolds = holds.filter((h) => h.batch_code === code);
        const heldBars = new Set(batchHolds.map((h) => h.bar));
        const bars = Array.from({ length: cut }, (_, i) => {
            const number = i + 1;
            const status = latest.get(number) === 'sale' ? 'sold' : heldBars.has(number) ? 'held' : 'available';
            return { number, status };
        });
        const sold = bars.filter((b) => b.status === 'sold').length;
        const held = batchHolds.length;
        out.set(code, {
            bars_cut: cut,
            sold,
            held,
            available: cut - sold - held,
            bars,
            holds: batchHolds.map((h) => ({ bar: h.bar, expires_at: h.expires_at })),
        });
    }
    return out;
}
export function publicBatch(batch, stock) {
    return {
        code: batch.code,
        scent: batch.scent,
        state: batch.state,
        bars_cut: stock.bars_cut,
        available: stock.available,
        held: stock.held,
        sold: stock.sold,
        bars: stock.bars,
        unit_price: money(BAR_CENTS),
        cure_date: cureDate(batch),
        drop_at: batch.drop_at ? batch.drop_at.toISOString() : null,
        drop_at_local: batch.drop_at ? localMinute(batch.drop_at) : null,
    };
}
