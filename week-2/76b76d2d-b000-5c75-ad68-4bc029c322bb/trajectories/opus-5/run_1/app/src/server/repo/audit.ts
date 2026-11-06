import { query, type Tx } from '../db/pool.ts';
import { toIso } from '../domain/time.ts';

export type AuditAction =
  | 'refund'
  | 'goodwill-credit'
  | 'reconciliation-accept'
  | 'season-withdraw'
  | 'enquiry-reply';

export async function writeAudit(
  tx: Tx,
  entry: { actor: string; action: AuditAction; target: string; amountCents: number | null; reason: string | null },
): Promise<number> {
  const row = await tx.one<{ id: number }>(
    'insert into audit_log(actor, action, target, amount_cents, reason) values($1,$2,$3,$4,$5) returning id',
    [entry.actor, entry.action, entry.target, entry.amountCents, entry.reason],
  );
  return row?.id ?? 0;
}

export type AuditEntry = {
  id: number;
  at: string;
  actor: string;
  action: AuditAction;
  target: string;
  amount_cents: number | null;
  reason: string | null;
};

export async function auditEntries(): Promise<AuditEntry[]> {
  const rows = await query<{
    id: number;
    at: Date;
    actor: string;
    action: AuditAction;
    target: string;
    amount_cents: number | null;
    reason: string | null;
  }>('select id, at, actor, action, target, amount_cents, reason from audit_log order by id desc');
  return rows.map((row) => ({ ...row, at: toIso(row.at) }));
}
