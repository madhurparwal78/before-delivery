import { randomUUID } from 'node:crypto';
import type { LedgerKind } from '../../shared/api.js';
import type { Queryable } from '../db/queryable.js';
import type { LedgerEntryRecord } from './present.js';

/** Ledger entries are written once per loan and kind, and are never edited or deleted. */
export async function writeLedgerEntry(
  db: Queryable,
  entry: { loanId: string; itemId: string; kind: LedgerKind; amountCents: number },
): Promise<void> {
  await db.query(
    `insert into ledger_entry (id, loan_id, item_id, kind, amount_cents, created_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (loan_id, kind) do nothing`,
    [randomUUID(), entry.loanId, entry.itemId, entry.kind, entry.amountCents],
  );
}

interface LedgerRow {
  id: string;
  loan_id: string;
  item_id: string;
  item_name: string;
  kind: string;
  amount_cents: number;
  created_at: Date;
}

export interface LedgerView {
  readonly entries: LedgerEntryRecord[];
  readonly depositsHeldCents: number;
}

export async function readLedger(db: Queryable, loanId: string | null): Promise<LedgerView> {
  const filter = loanId === null ? '' : 'where e.loan_id = $1';
  const result = await db.query<LedgerRow>(
    `select e.id, e.loan_id, e.item_id, i.name as item_name, e.kind, e.amount_cents, e.created_at
     from ledger_entry e join item i on i.id = e.item_id
     ${filter}
     order by e.seq asc`,
    loanId === null ? [] : [loanId],
  );
  const held = await db.query<{ total: string | null }>(
    `select sum(amount_cents)::text as total from ledger_entry
     where kind in ('deposit_hold', 'deposit_release', 'damage_charge')`,
  );
  return {
    entries: result.rows.map((row) => ({
      id: row.id,
      loanId: row.loan_id,
      itemId: row.item_id,
      itemName: row.item_name,
      kind: row.kind as LedgerKind,
      amountCents: row.amount_cents,
      createdAt: row.created_at,
    })),
    depositsHeldCents: Number(held.rows[0]?.total ?? '0'),
  };
}
