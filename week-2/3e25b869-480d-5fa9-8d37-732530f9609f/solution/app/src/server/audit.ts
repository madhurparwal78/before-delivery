// The append-only finance audit: one entry per refund, credit, accepted figure and orphan refund.
import { money } from '../shared/money.js';
import { allow, requireStaff, type Staff } from './auth.js';
import { type Db, pool } from './db.js';
import { route } from './http.js';

type AuditAction = 'refund' | 'credit' | 'reconciliation_accept' | 'orphan_refund';

interface AuditRow {
  id: number;
  at: Date;
  actor: string;
  role: string;
  action: AuditAction;
  target: string;
  reason: string;
  amount_cents: number;
  killbill_ref: string | null;
  outcome: 'issued' | 'failed';
}

const auditJson = (e: AuditRow) => ({
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
export async function writeAudit(
  db: Db,
  staff: Staff,
  entry: { action: AuditAction; target: string; reason: string; amount_cents: number; killbill_ref: string | null; outcome: 'issued' | 'failed' },
  at: Date,
) {
  const created = await db.query(
    `INSERT INTO audit (at, actor, role, action, target, reason, amount_cents, killbill_ref, outcome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [at, staff.email, staff.role, entry.action, entry.target, entry.reason, entry.amount_cents, entry.killbill_ref, entry.outcome],
  );
  return auditJson(created.rows[0] as AuditRow);
}

route('GET', '/api/staff/audit', async (ctx) => {
  allow(ctx, await requireStaff(ctx), 'books');
  const entries = (await pool.query<AuditRow>('SELECT * FROM audit ORDER BY id DESC')).rows;
  return { status: 200, body: { entries: entries.map(auditJson) } };
});
