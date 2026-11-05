// Contract state machine, history entries and hold expiry (DP-41, DP-42, DP-43).
import type { PoolClient } from "pg";
import type { ContractStatus, HistoryEntry } from "../../shared/domain.js";

export const TRANSITIONS: Record<string, ContractStatus[]> = {
  reserved: ["agreement_sent", "expired"],
  agreement_sent: ["agreement_sent", "signed", "expired"],
  signed: ["active"],
  active: ["exchanged", "paid_off", "returned", "written_off"],
};

export function transitionAllowed(from: ContractStatus, to: ContractStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export async function appendHistory(
  client: PoolClient,
  contractId: string,
  from: ContractStatus | null,
  to: ContractStatus,
  at: Date,
  actor: "owner" | "parent" | "system",
  actorName: string | null
): Promise<void> {
  const seqRows = await client.query<{ seq: string }>(
    "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM contract_history WHERE contract_id = $1",
    [contractId]
  );
  await client.query(
    `INSERT INTO contract_history (contract_id, from_status, to_status, at, actor, actor_name, seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [contractId, from, to, at, actor, actorName, BigInt(seqRows.rows[0].seq)]
  );
}

export async function historyFor(client: PoolClient, contractId: string): Promise<HistoryEntry[]> {
  const rows = await client.query<Record<string, unknown>>(
    "SELECT from_status, to_status, at, actor, actor_name FROM contract_history WHERE contract_id = $1 ORDER BY seq ASC",
    [contractId]
  );
  return rows.rows.map((r) => ({
    from: (r.from_status as string | null) ?? null,
    to: r.to_status as string,
    at: (r.at as Date).toISOString().replace(/\.\d{3}Z$/, "Z"),
    actor: r.actor as HistoryEntry["actor"],
    actor_name: (r.actor_name as string | null) ?? null,
  }));
}

// Unsigned holds expire at their deadline with no request needed to trigger
// it. Recorded exactly once, at the exact deadline.
export async function sweepExpiredContracts(client: PoolClient, now: Date): Promise<void> {
  const candidates = await client.query<{ id: string; status: string; hold_expires_at: Date }>(
    `SELECT id, status, hold_expires_at FROM contracts
      WHERE status IN ('reserved', 'agreement_sent') AND hold_expires_at <= $1`,
    [now]
  );
  for (const c of candidates.rows) {
    // One winner across instances: the UPDATE ... WHERE re-checks the status.
    const updated = await client.query(
      `UPDATE contracts SET status = 'expired'
        WHERE id = $1 AND status IN ('reserved','agreement_sent') AND hold_expires_at <= $2`,
      [c.id, now]
    );
    if (updated.rowCount === 1) {
      await appendHistory(client, c.id, c.status as ContractStatus, "expired", c.hold_expires_at, "system", null);
      const instrument = await client.query<{ id: string; status: string }>(
        "UPDATE instruments SET status = 'available', current_contract_id = NULL WHERE current_contract_id = $1 RETURNING id",
        [c.id]
      );
      void instrument;
      await client.query(
        "UPDATE signing_links SET status = 'expired' WHERE contract_id = $1 AND status = 'live'",
        [c.id]
      );
    }
  }
}

export async function equityOf(client: PoolClient, contractId: string): Promise<number> {
  const rows = await client.query<{ sum: string | null }>(
    "SELECT COALESCE(SUM(amount_cents), 0) AS sum FROM ledger_entries WHERE contract_id = $1",
    [contractId]
  );
  return Number(rows.rows[0].sum);
}

export async function contractById(client: PoolClient, id: string): Promise<Record<string, unknown> | null> {
  const rows = await client.query<Record<string, unknown>>("SELECT * FROM contracts WHERE id = $1", [id]);
  return rows.rows.length > 0 ? rows.rows[0] : null;
}

// The next ledger seq: safe because every ledger write holds the contract's
// one-at-a-time advisory lock.
export async function nextLedgerSeq(client: PoolClient, contractId: string): Promise<bigint> {
  const rows = await client.query<{ seq: string }>(
    "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM ledger_entries WHERE contract_id = $1",
    [contractId]
  );
  return BigInt(rows.rows[0].seq);
}
