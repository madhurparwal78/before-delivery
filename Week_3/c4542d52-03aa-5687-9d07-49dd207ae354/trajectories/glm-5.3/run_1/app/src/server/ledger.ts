import type { PoolClient } from 'pg';

export type LedgerKind =
  | 'issuance'
  | 'grant_accepted'
  | 'exercise_issued'
  | 'options_cancelled'
  | 'tender_transfer'
  | 'pool_resized';

export interface LedgerEntryRow {
  id: string;
  at: Date;
  holder_id: string | null;
  holder_name: string;
  kind: LedgerKind;
  class: string;
  shares_delta: number;
  options_delta: number;
  reference: string;
}

export async function nextLedgerId(client: PoolClient): Promise<string> {
  const r = await client.query<{ max: string | null }>(
    "SELECT max(substring(id from 5)::bigint)::text AS max FROM securities_ledger WHERE id LIKE 'LED-%'",
  );
  const n = Number(r.rows[0]?.max ?? 0) + 1;
  return `LED-${String(n).padStart(6, '0')}`;
}

/** Writes exactly one ledger entry. Caller owns the transaction. */
export async function writeLedgerEntry(
  client: PoolClient,
  entry: {
    holder_id: string | null;
    holder_name: string;
    kind: LedgerKind;
    class: string;
    shares_delta: number;
    options_delta: number;
    reference: string;
  },
): Promise<LedgerEntryRow> {
  const id = await nextLedgerId(client);
  const r = await client.query<LedgerEntryRow>(
    `INSERT INTO securities_ledger (id, holder_id, holder_name, kind, class, shares_delta, options_delta, reference)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, entry.holder_id, entry.holder_name, entry.kind, entry.class, entry.shares_delta, entry.options_delta, entry.reference],
  );
  return r.rows[0]!;
}
