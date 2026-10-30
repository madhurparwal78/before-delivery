import { randomUUID } from "node:crypto";
import { many, one, pool, tx } from "./db.js";
import { deliver } from "./mail.js";
const CLAIM_SECONDS = 60;
const RETRY_SECONDS = 5;
/** Records a message already claimed by the calling request, so no worker sends it meanwhile. */
export async function enqueue(db, message, owner) {
    const row = {
        id: randomUUID(),
        to_address: message.to,
        subject: message.subject,
        body: message.body,
        invite_id: owner.invite_id ?? null,
        link_id: owner.link_id ?? null,
    };
    await db.query(`INSERT INTO outbox (id, to_address, subject, body, invite_id, link_id, locked_until)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))`, [row.id, row.to_address, row.subject, row.body, row.invite_id, row.link_id, CLAIM_SECONDS]);
    return row;
}
async function markSent(db, row) {
    if (row.invite_id) {
        const invite = await one(db, "UPDATE invites SET email_status = 'sent' WHERE id = $1 RETURNING project_id, user_id", [row.invite_id]);
        if (invite) {
            await db.query(`UPDATE memberships SET email_status = 'sent' WHERE project_id = $1 AND user_id = $2 AND NOT EXISTS (
           SELECT 1 FROM invites i WHERE i.project_id = $1 AND i.user_id = $2 AND i.email_status = 'queued')`, [invite.project_id, invite.user_id]);
        }
    }
    if (row.link_id)
        await db.query("UPDATE reviewer_links SET email_status = 'sent' WHERE id = $1", [row.link_id]);
    await db.query("DELETE FROM outbox WHERE id = $1", [row.id]);
}
/**
 * One delivery attempt, recorded through `db` (the caller's transaction when a request sends its own email, so a
 * replay of that request sees the final status). True once the mail server accepted it; failure leaves it queued.
 */
export async function attempt(db, row, retryAfterSeconds = RETRY_SECONDS) {
    try {
        await deliver({ to: row.to_address, subject: row.subject, body: row.body });
    }
    catch {
        await db.query("UPDATE outbox SET locked_until = now() + make_interval(secs => $2) WHERE id = $1", [row.id, retryAfterSeconds]);
        return false;
    }
    await markSent(db, row);
    return true;
}
/** Retries queued messages; each is claimed by one instance at a time so it is delivered at most once. */
export async function retryQueued() {
    const claimed = await many(pool, `UPDATE outbox SET locked_until = now() + make_interval(secs => $1)
     WHERE id IN (SELECT id FROM outbox WHERE locked_until <= now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING id, to_address, subject, body, invite_id, link_id`, [CLAIM_SECONDS]);
    for (const row of claimed)
        await tx((db) => attempt(db, row));
}
