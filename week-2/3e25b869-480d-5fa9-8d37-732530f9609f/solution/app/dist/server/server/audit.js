// The append-only finance audit: one entry per refund, credit, accepted figure and orphan refund.
import { money } from '../shared/money.js';
import { allow, requireStaff } from './auth.js';
import { pool } from './db.js';
import { route } from './http.js';
const auditJson = (e) => ({
    id: e.id,
    at: e.at.toISOString(),
    actor: e.actor,
    role: e.role,
    action: e.action,
    target: e.target,
    reason: e.reason,
    amount: money(e.amount_cents),
    killbill_ref: e.killbill_ref,
    outcome: e.outcome,
});
/** Writes one entry inside the action's own transaction. */
export async function writeAudit(db, staff, entry, at) {
    const created = await db.query(`INSERT INTO audit (at, actor, role, action, target, reason, amount_cents, killbill_ref, outcome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [at, staff.email, staff.role, entry.action, entry.target, entry.reason, entry.amount_cents, entry.killbill_ref, entry.outcome]);
    return auditJson(created.rows[0]);
}
route('GET', '/api/staff/audit', async (ctx) => {
    allow(ctx, await requireStaff(ctx), 'books');
    const entries = (await pool.query('SELECT * FROM audit ORDER BY id DESC')).rows;
    return { status: 200, body: { entries: entries.map(auditJson) } };
});
