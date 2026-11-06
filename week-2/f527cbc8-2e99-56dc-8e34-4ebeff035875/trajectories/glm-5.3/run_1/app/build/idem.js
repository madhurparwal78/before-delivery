import crypto from 'node:crypto';
import { withTx } from './db.js';
import { config } from './config.js';
import { now } from './time.js';
function bodyHash(parsed, raw) {
    if (raw)
        return crypto.createHash('sha256').update(raw).digest('hex');
    return crypto.createHash('sha256').update(JSON.stringify(parsed ?? null)).digest('hex');
}
export async function claimIdempotency(userId, route, key, parsed, raw) {
    const hash = bodyHash(parsed, raw);
    return withTx(async (tx) => {
        await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`idem:${userId}:${route}:${key}`]);
        const existing = await tx.query(`select * from idem_claims where user_id = $1 and route = $2 and key = $3`, [userId, route, key]);
        if (existing.length === 0) {
            await tx.query(`insert into idem_claims(user_id, route, key, request_hash, status, lease_expires_at, created_at)
         values($1,$2,$3,$4,'in_progress',$5,$6)`, [userId, route, key, hash, new Date(now().getTime() + config.idempotencyLeaseSeconds * 1000), now()]);
            return { kind: 'fresh' };
        }
        const row = existing[0];
        if (row.request_hash !== hash)
            return { kind: 'conflict' };
        if (row.status === 'done') {
            return { kind: 'replay', status: row.response_status ?? 200, body: row.response_body ?? '{}' };
        }
        if (row.lease_expires_at.getTime() > now().getTime()) {
            return { kind: 'in_progress' };
        }
        await tx.query(`update idem_claims set lease_expires_at = $4 where user_id = $1 and route = $2 and key = $3`, [userId, route, key, new Date(now().getTime() + config.idempotencyLeaseSeconds * 1000)]);
        return { kind: 'takeover' };
    });
}
export async function completeIdempotency(userId, route, key, status, body) {
    await withTx(async (tx) => {
        await tx.query(`update idem_claims set status = 'done', response_status = $4, response_body = $5
       where user_id = $1 and route = $2 and key = $3`, [userId, route, key, status, body]);
    });
}
export async function releaseIdempotency(userId, route, key) {
    await withTx(async (tx) => {
        await tx.query(`delete from idem_claims where user_id = $1 and route = $2 and key = $3 and status = 'in_progress'`, [userId, route, key]);
    });
}
