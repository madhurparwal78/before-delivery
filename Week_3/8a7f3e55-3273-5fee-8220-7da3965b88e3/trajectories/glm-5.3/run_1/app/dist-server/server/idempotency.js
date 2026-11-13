import { ApiError } from './errors.js';
import { FIELD_MESSAGES } from '../shared/terms.js';
/** A valid key is 1 to 100 visible ASCII characters (codes 33 to 126). */
export function validateKey(key) {
    if (key.length < 1 || key.length > 100) {
        return new ApiError('validation', 'The Idempotency-Key header is not valid.', {
            fields: { idempotency_key: FIELD_MESSAGES.idempotency_key },
        });
    }
    for (let i = 0; i < key.length; i++) {
        const code = key.charCodeAt(i);
        if (code < 33 || code > 126) {
            return new ApiError('validation', 'The Idempotency-Key header is not valid.', {
                fields: { idempotency_key: FIELD_MESSAGES.idempotency_key },
            });
        }
    }
    return null;
}
/** Claim the key for the user. Answers in_progress for a key still being processed, replay
 * for a stored finished answer to the same method, path and body, reused otherwise. */
export async function claimKey(client, userId, key, method, path, body) {
    const existing = await client.query('SELECT state, method, path, body, status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
    const row = existing.rows[0];
    const sameRequest = row !== undefined && row.method === method && row.path === path && row.body?.equals(body);
    if (row !== undefined && row.state === 'pending') {
        return { kind: 'in_progress' };
    }
    if (row !== undefined && sameRequest && row.status !== null && row.status !== 503) {
        return { kind: 'replay', status: row.status, body: row.response_body ?? '' };
    }
    if (row !== undefined && !sameRequest) {
        return { kind: 'reused' };
    }
    if (row !== undefined && row.status === 503) {
        // A 503 stored nothing; the key is retried afresh.
        await client.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
    }
    await client.query(`INSERT INTO idempotency_keys (user_id, key, state, method, path, body, status, response_body, claimed_at)
     VALUES ($1, $2, 'pending', $3, $4, $5, NULL, NULL, now())
     ON CONFLICT (user_id, key) DO UPDATE SET state = 'pending', method = EXCLUDED.method,
       path = EXCLUDED.path, body = EXCLUDED.body, status = NULL, response_body = NULL, claimed_at = now()`, [userId, key, method, path, body]);
    return { kind: 'new' };
}
/** Store the finished answer, except a 503, which stores nothing so the key can be retried. */
export async function finishKey(db, userId, key, status, responseBody) {
    if (status === 503) {
        await db.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
        return;
    }
    await db.query(`UPDATE idempotency_keys SET state = 'done', status = $3, response_body = $4, finished_at = now()
     WHERE user_id = $1 AND key = $2`, [userId, key, status, responseBody]);
}
/** Claimed-but-abandoned keys are released so a later request can run the action. */
export async function releaseKey(db, userId, key) {
    await db.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND state = \'pending\'', [userId, key]);
}
export async function gcKeys(db) {
    await db.query('DELETE FROM idempotency_keys WHERE claimed_at < now() - interval \'24 hours\'');
}
