import crypto from 'node:crypto';
import { config } from './config.js';
import { connectDb } from './db.js';
import { now } from './time.js';
import { sendSmtp } from './smtp.js';
function newId() {
    return crypto.randomUUID();
}
export async function queueEmail(tx, msg, requestClaim) {
    const id = newId();
    const t = now();
    await tx.query(`insert into emails(id, to_addr, subject, body, request_claimed, claim_expires_at, claimed_by, next_attempt_at, created_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        id, msg.to, msg.subject, msg.body,
        requestClaim, requestClaim ? new Date(t.getTime() + config.jobLeaseSeconds * 1000) : null,
        requestClaim ? config.instanceLabel : null,
        t, t
    ]);
    return id;
}
export async function trySend(msg) {
    return sendSmtp(msg);
}
export async function attemptRequestClaimed(emailId) {
    const db = connectDb();
    const rows = await db.query(`select * from emails where id = $1 and sent_at is null and request_claimed = true and claimed_by = $2 and last_attempt_at is null`, [emailId, config.instanceLabel]);
    const e = rows.rows[0];
    if (!e)
        return;
    const ok = await trySend({ to: e.to_addr, subject: e.subject, body: e.body });
    await db.query(`update emails set sent_at = $2, last_attempt_at = $3, claimed_by = null, claim_expires_at = null, attempts = attempts + 1 where id = $1`, [emailId, ok ? now() : null, now()]);
}
export async function mailUp() {
    return sendSmtp({ to: 'probe@clinchline.test', subject: 'probe', body: '' });
}
