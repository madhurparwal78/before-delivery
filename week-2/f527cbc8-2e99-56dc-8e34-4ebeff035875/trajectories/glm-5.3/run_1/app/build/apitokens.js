import crypto from 'node:crypto';
import { connectDb } from './db.js';
export function tokenHash(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}
export function newTokenPlaintext() {
    return 'cl_' + crypto.randomBytes(32).toString('base64url');
}
export async function resolveToken(bearer) {
    const hash = tokenHash(bearer);
    const rows = await connectDb().query(`select id, name, scope from tokens where token_hash = $1 and revoked_at is null`, [hash]);
    const row = rows.rows[0];
    if (!row)
        return null;
    return {
        type: 'token',
        id: row.id,
        role: 'farrier_token',
        name: row.name,
        email: '',
        scope: row.scope
    };
}
