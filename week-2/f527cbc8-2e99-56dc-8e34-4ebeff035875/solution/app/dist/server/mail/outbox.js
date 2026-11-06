// The Postgres email outbox (brief: Services, Email outage). Each event's email is queued once, by dedupe key, in
// the same transaction as the event.
// - Request-queued: the queuing instance claims the message in that transaction and makes the first attempt once
//   it commits; after a failed send no instance tries again for 20 s; then any instance retries it.
// - Background-queued: any instance may claim it at once; an instance whose send fails releases it and leaves it to
//   the others for 20 s.
import { randomUUID } from "node:crypto";
import { now, plusSeconds } from "../clock.js";
import { config } from "../config.js";
import { afterCommit, currentContext } from "../context.js";
import { db } from "../db.js";
import { log } from "../log.js";
import { MailUnavailable, SmtpConnection } from "./smtp.js";
const HOLD_OFF_S = 20;
const BATCH = 20;
const instanceId = randomUUID();
/** Queues one email per dedupe key; a request's own messages are claimed for its first attempt. */
export async function queueEmail(client, dedupeKey, mail) {
    const context = currentContext();
    const at = now();
    const fromRequest = context.origin === "request";
    const { rows } = await client.query(`INSERT INTO outbox (id, dedupe_key, recipient, subject, body, status, origin, claimed_by, claim_expires_at, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $9)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`, [
        randomUUID(),
        dedupeKey,
        mail.to,
        mail.subject,
        mail.body,
        context.origin,
        fromRequest ? instanceId : null,
        fromRequest ? plusSeconds(at, config.jobLeaseSeconds) : null,
        new Date(at),
    ]);
    const id = rows[0]?.id;
    if (id && fromRequest)
        afterCommit(() => sendRequestEmails([id]));
}
async function markSent(id) {
    await db.query(`UPDATE outbox SET status = 'sent', sent_at = $2, claimed_by = NULL WHERE id = $1`, [id, new Date(now())]);
}
/** A failed send: request-queued first attempts start the 20 s hold-off; this instance leaves the message alone for 20 s. */
async function markFailed(ids, firstAttempt) {
    const at = now();
    await db.query(`UPDATE outbox SET claimed_by = NULL, claim_expires_at = NULL, failed_by = $2, failed_at = $3,
            next_attempt_at = CASE WHEN $4 THEN $5 ELSE next_attempt_at END
      WHERE id = ANY($1) AND status = 'pending'`, [ids, instanceId, new Date(at), firstAttempt, plusSeconds(at, HOLD_OFF_S)]);
}
async function deliver(messages, firstAttempt) {
    let connection;
    try {
        connection = await SmtpConnection.open();
    }
    catch (error) {
        if (!(error instanceof MailUnavailable))
            throw error;
        await markFailed(messages.map((m) => m.id), firstAttempt);
        log("warn", "email delivery failed; queued for retry", { count: messages.length, error: error.message });
        return;
    }
    try {
        for (const [index, message] of messages.entries()) {
            try {
                await connection.send(message);
            }
            catch (error) {
                if (!(error instanceof MailUnavailable))
                    throw error;
                await markFailed(messages.slice(index).map((m) => m.id), firstAttempt);
                log("warn", "email delivery failed; queued for retry", { count: messages.length - index, error: error.message });
                return;
            }
            await markSent(message.id);
        }
    }
    finally {
        connection.close();
    }
}
const CLAIMED_COLUMNS = `id, recipient AS "to", subject, body`;
/** The first attempt at the messages this request queued, once its transactions have committed. */
async function sendRequestEmails(ids) {
    const { rows } = await db.query(`SELECT ${CLAIMED_COLUMNS} FROM outbox WHERE id = ANY($1) AND status = 'pending' AND claimed_by = $2 ORDER BY created_at`, [ids, instanceId]);
    if (rows.length)
        await deliver(rows, true);
}
/** One outbox pass: claims due messages this instance may try and sends them. */
export async function drainOutbox() {
    const at = now();
    const due = await db.query(`SELECT 1 FROM outbox WHERE status = 'pending' AND next_attempt_at <= $1
        AND (claimed_by IS NULL OR claim_expires_at <= $1)
        AND (failed_by IS DISTINCT FROM $2 OR failed_at <= $3) LIMIT 1`, [new Date(at), instanceId, new Date(at - HOLD_OFF_S * 1000)]);
    if (!due.rowCount)
        return;
    const { rows } = await db.query(`UPDATE outbox SET claimed_by = $2, claim_expires_at = $4
      WHERE id IN (SELECT id FROM outbox
                    WHERE status = 'pending' AND next_attempt_at <= $1
                      AND (claimed_by IS NULL OR claim_expires_at <= $1)
                      AND (failed_by IS DISTINCT FROM $2 OR failed_at <= $3)
                    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $5)
      RETURNING ${CLAIMED_COLUMNS}`, [new Date(at), instanceId, new Date(at - HOLD_OFF_S * 1000), plusSeconds(at, config.jobLeaseSeconds), BATCH]);
    if (rows.length)
        await deliver(rows, false);
}
