import { connectDb } from './db.js';
export async function loadSession(token) {
    const rows = await connectDb().query(`select s.id as session_id, u.id, u.name, u.email, u.role, u.barn_id
     from sessions s join users u on u.id = s.user_id where s.id = $1`, [token]);
    return rows.rows[0] ?? null;
}
export async function resolveSession(token) {
    const row = await loadSession(token);
    if (!row)
        return null;
    return {
        type: 'session',
        id: row.id,
        role: row.role,
        name: row.name,
        email: row.email
    };
}
export function currentRole(c) {
    if (c.type === 'token')
        return 'farrier';
    return c.role;
}
