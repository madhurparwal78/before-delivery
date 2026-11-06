// The outstanding balance alert: one email and one Notices line when the unpaid total crosses above the threshold,
// re-armed only after it falls back to or below it. The armed state is kept in Postgres per threshold value, so
// instances started with different thresholds arm and alert independently (brief: Business rules, Ledger and
// dashboard, Alert).
import { now } from "./clock.js";
import { config } from "./config.js";
import { outstandingAlertMail } from "./mail/messages.js";
import { queueEmail } from "./mail/outbox.js";
/** Evaluates the alert after a change to an unpaid balance, inside that change's transaction. */
export async function checkOutstandingAlert(client) {
    const threshold = config.alertOutstandingCents;
    await client.query(`INSERT INTO alert_state (threshold_cents, armed) VALUES ($1, true) ON CONFLICT DO NOTHING`, [threshold]);
    const { rows } = await client.query(`SELECT armed FROM alert_state WHERE threshold_cents = $1 FOR UPDATE`, [threshold]);
    const armed = rows[0]?.armed ?? true;
    const { rows: sums } = await client.query(`SELECT coalesce(sum(balance_cents), 0)::bigint AS outstanding FROM invoices WHERE status = 'unpaid'`);
    const outstanding = sums[0]?.outstanding ?? 0;
    if (armed && outstanding > threshold) {
        await client.query(`UPDATE alert_state SET armed = false WHERE threshold_cents = $1`, [threshold]);
        const { rows: made } = await client.query(`INSERT INTO outstanding_alerts (threshold_cents, outstanding_cents, at) VALUES ($1, $2, $3) RETURNING id`, [threshold, outstanding, new Date(now())]);
        const { rows: farriers } = await client.query(`SELECT name, email FROM users WHERE role = 'farrier'`);
        for (const farrier of farriers) {
            await queueEmail(client, `outstanding-alert:${made[0]?.id ?? 0}:${farrier.email}`, outstandingAlertMail({ to: farrier.email, name: farrier.name, thresholdCents: threshold, outstandingCents: outstanding }));
        }
    }
    else if (!armed && outstanding <= threshold) {
        await client.query(`UPDATE alert_state SET armed = true WHERE threshold_cents = $1`, [threshold]);
    }
}
