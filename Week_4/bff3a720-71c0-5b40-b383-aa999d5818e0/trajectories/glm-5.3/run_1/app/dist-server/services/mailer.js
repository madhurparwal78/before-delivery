import { newId } from './ids.js';
/**
 * Emails leave only through the durable outbox. Rows are written inside the caller's
 * transaction; after commit the caller tries each fresh row once, and the sweep
 * retries the rest until Mailpit accepts them.
 */
export class Mailer {
    smtp;
    constructor(smtp) {
        this.smtp = smtp;
    }
    /** Writes one durable row inside the caller's transaction and returns its id. */
    async queue(client, kind, to, subject, body, nowMs) {
        const id = newId();
        await client.query(`INSERT INTO outbox (id, kind, to_email, subject, body, status, attempts, created_at)
       VALUES ($1,$2,$3,$4,$5,'queued',0,$6)`, [id, kind, to, subject, body, nowMs]);
        return id;
    }
    async trySend(db, id, nowMs) {
        const claimed = await db.query(`UPDATE outbox SET attempts = attempts + 1, last_attempt_at = $2
       WHERE id = $1 AND status = 'queued' RETURNING to_email, subject, body`, [id, nowMs]);
        if (claimed.rows.length === 0)
            return false;
        const row = claimed.rows[0];
        const ok = await this.smtp.send({ to: row.to_email, subject: row.subject, body: row.body });
        if (ok) {
            await db.query(`UPDATE outbox SET status = 'sent', sent_at = $2 WHERE id = $1`, [id, nowMs]);
        }
        return ok;
    }
    async drain(db) {
        const rows = await db.query(`SELECT id FROM outbox WHERE status = 'queued' ORDER BY created_at LIMIT 100`);
        for (const r of rows.rows) {
            const ok = await this.trySend(db, String(r.id), Date.now());
            if (ok)
                await new Promise(res => setTimeout(res, 5));
        }
    }
}
