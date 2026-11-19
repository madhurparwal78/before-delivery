import { errors } from './errors.js';
export const SESSION_COOKIE = 'ag_session';
export async function requireUser(deps, sessionId) {
    if (sessionId === undefined || sessionId === '')
        throw errors.unauthenticated();
    const result = await deps.pool.query(`SELECT u.id, u.email, u.display_name, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`, [sessionId]);
    const row = result.rows[0];
    if (row === undefined || row.expires_at.getTime() < Date.now())
        throw errors.unauthenticated();
    return { id: row.id, email: row.email, display_name: row.display_name };
}
export async function membership(deps, setId, userId) {
    const result = await deps.pool.query('SELECT role FROM members WHERE set_id = $1 AND user_id = $2', [setId, userId]);
    if (result.rowCount === 0)
        return null;
    return result.rows[0].role;
}
export async function requireMember(deps, setId, userId) {
    const role = await membership(deps, setId, userId);
    if (role === null)
        throw errors.notFound();
    return role;
}
export function requireWrite(role) {
    if (role === 'viewer')
        throw errors.forbidden();
}
export function requireOwner(role) {
    if (role !== 'owner')
        throw errors.forbidden();
}
