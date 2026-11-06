/**
 * The effective-dated share-count ledger. The count in effect on a date is the
 * opening count plus the signed shares of every event whose effective date is
 * on or before it and whose restatement is currently published.
 */
import { Transaction } from './db';
import { ShareEventKind } from '../shared/labels';

export const OPENING_DILUTED_SHARES = 148_250_000n;

interface LedgerRow {
  kind: string;
  shares: string;
}

export function signedShares(kind: ShareEventKind, shares: bigint): bigint {
  return kind === 'buyback' ? -shares : shares;
}

export async function dilutedSharesInEffect(
  tx: Transaction,
  onDate: string,
  excludeRestatementId: string | null = null,
): Promise<bigint> {
  const rows = await tx.query<LedgerRow>(
    `SELECT e.kind, e.shares
       FROM share_event e
       JOIN restatement r ON r.id = e.restatement_id
      WHERE r.state = 'published'
        AND e.effective_date <= $1
        AND ($2::text IS NULL OR e.restatement_id <> $2)`,
    [onDate, excludeRestatementId],
  );
  let total = OPENING_DILUTED_SHARES;
  for (const row of rows) {
    total += signedShares(row.kind as ShareEventKind, BigInt(row.shares));
  }
  return total;
}
