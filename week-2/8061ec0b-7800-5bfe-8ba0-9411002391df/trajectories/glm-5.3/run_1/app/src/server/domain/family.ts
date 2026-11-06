// Family totals (DP-38): computed at request time, from the caller's own
// family only, under the hold rule.
import type { PoolClient } from "pg";

export interface FamilyTotals {
  open_contracts: number;
  equity_cents: number;
  owned: number;
}

export async function familyTotals(client: PoolClient, familyId: string): Promise<FamilyTotals> {
  const rows = await client.query<{ open_count: string; equity: string | null; owned: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('reserved','agreement_sent','signed','active')) AS open_count,
       COALESCE(SUM(
         CASE WHEN status IN ('reserved','agreement_sent','signed','active') THEN (
           SELECT COALESCE(SUM(le.amount_cents), 0) FROM ledger_entries le WHERE le.contract_id = contracts.id
         ) ELSE 0 END
       ), 0) AS equity,
       COUNT(*) FILTER (WHERE status = 'paid_off') AS owned
     FROM contracts WHERE family_id = $1`,
    [familyId]
  );
  const r = rows.rows[0];
  return {
    open_contracts: Number(r.open_count),
    equity_cents: Number(r.equity),
    owned: Number(r.owned),
  };
}
