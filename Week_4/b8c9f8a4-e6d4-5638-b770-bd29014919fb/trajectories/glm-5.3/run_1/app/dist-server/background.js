import { pool } from './db.js';
import { sendAlert } from './providers.js';
/**
 * The background pass: persist offer lapse and send one offer_lapsing alert per offer
 * once an open or needs-re-read offer has no more than OFFER_WARNING_SECONDS left.
 * Runs on every instance against one database; the alert row guards one send per offer.
 */
export function startBackgroundPass(cfg) {
    const tick = async () => {
        try {
            await pool.query(`UPDATE offers SET status = 'lapsed' WHERE status IN ('open','needs_reread') AND lapses_at <= now()`);
            const due = await pool.query(`SELECT o.id, o.car_id FROM offers o
         WHERE o.status IN ('open','needs_reread')
         AND o.lapses_at <= now() + ($1 || ' seconds')::interval
         AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.car_id = o.car_id AND a.kind = 'offer_lapsing' AND a.source_offer_id = o.id)`, [String(cfg.offerWarningSeconds)]);
            for (const offer of due.rows) {
                const id = cryptoRandomUuid();
                const inserted = await pool.query(`INSERT INTO alerts (id, car_id, kind, state, source_offer_id)
           SELECT $1, $2, 'offer_lapsing', 'waiting', $3
           WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE car_id = $2 AND kind = 'offer_lapsing' AND source_offer_id = $3)
           RETURNING id`, [id, offer.car_id, offer.id]);
                if (inserted.rows.length === 0)
                    continue;
                const message = 'Offer about to lapse';
                const delivered = await sendAlert(cfg, message);
                if (delivered) {
                    await pool.query(`UPDATE alerts SET state = 'delivered', delivered_at = now() WHERE id = $1`, [inserted.rows[0].id]);
                }
                else {
                    await pool.query(`UPDATE alerts SET state = 'failed' WHERE id = $1`, [inserted.rows[0].id]);
                }
            }
        }
        catch { /* the database is unreachable; the next tick retries */ }
    };
    void tick();
    const timer = setInterval(tick, 2_000);
    timer.unref?.();
}
function cryptoRandomUuid() {
    return crypto.randomUUID();
}
