// Contract state moves. Every move goes through here and appends exactly one history entry in the same step.

import type { HistoryEntry } from "../../shared/api.js";
import type { ContractStatus } from "../../shared/vocabulary.js";
import { invalidTransition } from "../http/errors.js";
import type { Db } from "../db/pool.js";

const MOVES: Partial<Record<ContractStatus, readonly ContractStatus[]>> = {
  reserved: ["agreement_sent", "expired"],
  agreement_sent: ["agreement_sent", "signed", "expired"],
  signed: ["active"],
  active: ["exchanged", "paid_off", "returned", "written_off"],
};

export type Actor = Pick<HistoryEntry, "actor" | "actor_name">;

/** Refuses with 409 invalid_transition unless `from → to` is a published move. */
function assertMove(from: ContractStatus, to: ContractStatus): void {
  if (!MOVES[from]?.includes(to)) throw invalidTransition();
}

async function appendHistory(db: Db, contractId: string, from: ContractStatus | null, to: ContractStatus,
  actor: Actor, at: Date): Promise<void> {
  await db.query(`INSERT INTO contract_history (contract_id, from_status, to_status, at, actor, actor_name)
    VALUES ($1, $2, $3, $4, $5, $6)`, [contractId, from, to, at, actor.actor, actor.actor_name]);
}

/** Columns a move may set alongside the status (closing time, anchors, flags). */
type MoveColumns = Partial<Record<"signed_at" | "activated_at" | "closed_at" | "billing_anchor_date" |
  "price_list_id" | "signer_name" | "subscription_state" | "agreement_stored" | "bill_of_sale_stored" | "successor_id",
  unknown>>;

/** Moves a contract from `from` to `to` (inside the caller's transaction) and appends its history entry. */
export async function moveContract(db: Db, move: { id: string; from: ContractStatus; to: ContractStatus; actor: Actor;
  at: Date; set?: MoveColumns }): Promise<void> {
  assertMove(move.from, move.to);
  const columns = Object.entries(move.set ?? {});
  const assignments = columns.map(([name], i) => `${name} = $${i + 4}`);
  const updated = await db.query(
    `UPDATE contracts SET ${["status = $2", ...assignments].join(", ")} WHERE id = $1 AND status = $3`,
    [move.id, move.to, move.from, ...columns.map(([, value]) => value)]);
  if (updated.rowCount !== 1) throw invalidTransition();
  await appendHistory(db, move.id, move.from, move.to, move.actor, move.at);
}

interface NewContract {
  id: string; student_id: string; instrument_serial: string; status: "reserved" | "active"; waiver: boolean;
  price_list_id: string | null; delivery_date: string; hold_expires_at: Date | null; signer_name: string | null;
  signed_at: Date | null; activated_at: Date | null; billing_anchor_date: string | null; predecessor_id: string | null;
  subscription_state: "active" | null; agreement_stored: boolean; created_at: Date;
}

/** Creates a contract (a reservation, or an exchange's successor) with its `from: null` history entry. */
export async function createContract(db: Db, contract: NewContract, actor: Actor): Promise<void> {
  const columns = Object.keys(contract);
  await db.query(`INSERT INTO contracts (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(contract));
  await appendHistory(db, contract.id, null, contract.status, actor, contract.created_at);
}

/**
 * Hold expiry: every reserved or agreement_sent contract whose deadline has passed becomes expired, with one
 * `system` history entry at exactly `hold_expires_at`. Row locks make concurrent sweeps record it once.
 */
export async function expireLapsedHolds(db: Db, at: Date): Promise<void> {
  await db.query(`
    WITH lapsed AS (
      SELECT id, status FROM contracts
      WHERE status IN ('reserved', 'agreement_sent') AND hold_expires_at <= $1
      ORDER BY id FOR UPDATE
    ), moved AS (
      UPDATE contracts c SET status = 'expired' FROM lapsed
      WHERE c.id = lapsed.id AND c.status IN ('reserved', 'agreement_sent')
      RETURNING c.id, lapsed.status AS from_status, c.hold_expires_at
    )
    INSERT INTO contract_history (contract_id, from_status, to_status, at, actor, actor_name)
    SELECT id, from_status, 'expired', hold_expires_at, 'system', NULL FROM moved`, [at]);
}
