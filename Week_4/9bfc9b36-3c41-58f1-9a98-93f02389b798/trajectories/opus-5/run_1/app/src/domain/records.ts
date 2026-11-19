import { randomUUID } from 'node:crypto';
import type { Transaction } from '../db/pool';

/** Codes, opaque ids and audit rows: every state change writes one row in its own transaction. */

const CODE_SHAPES: Readonly<Record<string, { prefix: string; width: number }>> = {
  boat: { prefix: 'B-', width: 2 },
  drawing: { prefix: 'BR-', width: 4 },
  roll: { prefix: 'R-', width: 2 },
  offcut: { prefix: 'O-', width: 2 },
  submission: { prefix: 'S-', width: 4 },
  grant: { prefix: 'G-', width: 4 },
  account: { prefix: 'A-', width: 2 },
};

/** New records continue each seeded sequence, with the same zero padding. */
export async function nextCode(tx: Transaction, name: keyof typeof CODE_SHAPES & string): Promise<string> {
  const row = await tx.one<{ next_value: string }>(
    'UPDATE code_sequence SET next_value = next_value + 1 WHERE name = $1 RETURNING next_value - 1 AS next_value',
    [name],
  );
  const shape = CODE_SHAPES[name] as { prefix: string; width: number };
  return `${shape.prefix}${String(row?.next_value ?? '1').padStart(shape.width, '0')}`;
}

export async function nextLedgerLineId(tx: Transaction): Promise<number> {
  const row = await tx.one<{ next_value: string }>(
    `UPDATE code_sequence SET next_value = next_value + 1 WHERE name = 'ledger_line'
     RETURNING next_value - 1 AS next_value`,
  );
  return Number(row?.next_value ?? 1);
}

export function opaqueId(prefix: string): string {
  return `${prefix}${randomUUID()}`;
}

export type AuditAction =
  | 'account.create' | 'account.delete' | 'account.rename' | 'account.role_change_refused'
  | 'boat.create' | 'boat.update' | 'measurement.record' | 'photo.attach'
  | 'submission.create' | 'submission.accept' | 'submission.reject' | 'submission.reverse'
  | 'ruleset.create' | 'ruleset.update'
  | 'drawing.create' | 'drawing.draw' | 'drawing.assign' | 'drawing.issue' | 'drawing.revise'
  | 'claim.take' | 'claim.lay' | 'claim.unlay' | 'claim.release' | 'claim.cut'
  | 'stock.receive' | 'stock.update' | 'stock.count'
  | 'grant.create' | 'grant.withdraw' | 'authority.create' | 'authority.withdraw'
  | 'payment.record' | 'credit_note.record';

export interface AuditEntry {
  readonly actorEmail: string;
  readonly action: AuditAction;
  readonly target: string;
  readonly before?: string | null;
  readonly after?: string | null;
  readonly reason?: string | null;
}

/**
 * One audit row per state change, written in the same transaction as the change,
 * with the acting account taken from its stored record.
 */
export async function audit(tx: Transaction, at: Date, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_trail (id, at, actor_email, action, target, before_state, after_state, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      opaqueId('AD-'),
      at.toISOString(),
      entry.actorEmail,
      entry.action,
      entry.target,
      entry.before ?? null,
      entry.after ?? null,
      entry.reason ?? null,
    ],
  );
}
