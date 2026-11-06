import { randomUUID } from 'node:crypto';
import { pool, type Queryable } from '../pool.js';
import type { OutgoingEmail } from '../../providers/smtp.js';

export interface QueuedEmail extends OutgoingEmail {
  id: string;
}

export async function queueEmail(db: Queryable, email: OutgoingEmail): Promise<void> {
  await db.query('INSERT INTO email_queue (id, recipient, subject, body) VALUES ($1,$2,$3,$4)', [
    randomUUID(),
    email.to,
    email.subject,
    email.body,
  ]);
}

export async function pendingEmails(limit: number): Promise<QueuedEmail[]> {
  const result = await pool.query<{ id: string; recipient: string; subject: string; body: string }>(
    `SELECT id, recipient, subject, body FROM email_queue
      WHERE delivered_at IS NULL ORDER BY created_at LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    to: row.recipient,
    subject: row.subject,
    body: row.body,
  }));
}

export async function markEmailDelivered(id: string): Promise<void> {
  await pool.query('UPDATE email_queue SET delivered_at = now() WHERE id = $1', [id]);
}

export async function countEmailAttempt(id: string): Promise<void> {
  await pool.query('UPDATE email_queue SET attempts = attempts + 1 WHERE id = $1', [id]);
}

export interface PendingReversal {
  id: string;
  tenantId: string;
  recordKind: 'credit' | 'external_charge';
  amountCents: number;
  description: string;
}

export async function recordPendingReversal(
  tenantId: string,
  recordKind: 'credit' | 'external_charge',
  amountCents: number,
  description: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO pending_reversals (id, tenant_id, record_kind, amount_cents, description)
     VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), tenantId, recordKind, amountCents, description],
  );
}

export async function pendingReversals(): Promise<PendingReversal[]> {
  const result = await pool.query<{
    id: string;
    tenant_id: string;
    record_kind: 'credit' | 'external_charge';
    amount_cents: number;
    description: string;
  }>('SELECT * FROM pending_reversals WHERE completed_at IS NULL ORDER BY created_at');
  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    recordKind: row.record_kind,
    amountCents: row.amount_cents,
    description: row.description,
  }));
}

export async function markReversalDone(id: string): Promise<void> {
  await pool.query('UPDATE pending_reversals SET completed_at = now() WHERE id = $1', [id]);
}
