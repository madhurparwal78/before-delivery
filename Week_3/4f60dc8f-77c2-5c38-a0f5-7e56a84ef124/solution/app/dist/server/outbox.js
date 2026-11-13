import { pool } from "./db.js";
import { documentHtml, renderPdf } from "./documents.js";
import { sendEmail } from "./mail.js";
import { sendPush } from "./push.js";
export async function queueEmail(db, email) {
    await db.query("INSERT INTO outbox (kind, payload) VALUES ('email', $1)", [JSON.stringify(email)]);
}
export async function queuePush(db, push) {
    await db.query("INSERT INTO outbox (kind, payload) VALUES ('push', $1)", [JSON.stringify(push)]);
}
/** Sends an email now, rendering its PDF first; an email that carries a PDF is never sent without it. */
async function deliverEmail(email) {
    const attachment = email.pdf ? { filename: email.pdf.filename, content: await renderPdf(documentHtml(email.pdf.document)) } : undefined;
    await sendEmail({ to: email.to, subject: email.subject, text: email.text, ...(attachment ? { attachment } : {}) });
}
/**
 * Claims one due row, locked for the length of its delivery so no other instance sends it too. A row waits while an
 * earlier unsent row for the same recipient exists, so each recipient's messages leave in the order they were written.
 * Returns false when nothing is due.
 */
async function deliverOne() {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const claimed = await client.query(`SELECT o.id, o.kind, o.payload FROM outbox o
        WHERE o.sent_at IS NULL AND o.attempt_after <= clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM outbox e WHERE e.sent_at IS NULL AND e.id < o.id AND e.kind = o.kind
                            AND e.payload->>'to' IS NOT DISTINCT FROM o.payload->>'to')
        ORDER BY o.id LIMIT 1 FOR UPDATE SKIP LOCKED`);
        const row = claimed.rows[0];
        if (!row) {
            await client.query("COMMIT");
            return false;
        }
        try {
            if (row.kind === "email")
                await deliverEmail(row.payload);
            else
                await sendPush(row.payload);
            await client.query("UPDATE outbox SET sent_at = clock_timestamp() WHERE id = $1", [row.id]);
        }
        catch {
            // The service is not accepting from this instance; the row steps aside briefly so another instance can send it.
            await client.query("UPDATE outbox SET attempt_after = clock_timestamp() + interval '3 seconds' WHERE id = $1", [row.id]);
        }
        await client.query("COMMIT");
        return true;
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
}
async function deliverPending() {
    for (let pass = 0; pass < 25 && (await deliverOne()); pass += 1)
        ;
}
export function startOutbox() {
    let running = false;
    setInterval(() => {
        if (running)
            return;
        running = true;
        // Postgres being unreachable only skips this pass; the next one tries again.
        deliverPending()
            .catch(() => undefined)
            .finally(() => (running = false));
    }, 1_000).unref();
}
