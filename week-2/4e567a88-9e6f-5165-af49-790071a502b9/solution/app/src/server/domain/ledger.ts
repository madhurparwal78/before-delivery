// The double-entry ledger: every movement is two entries of equal size and opposite sign.

import type { Db } from "../db";
import { rows, single } from "../db";

export type MovementKind = "opening_grant" | "top_up" | "reserve" | "settle" | "release";
export type Account = "funding" | "available" | "reserved" | "settled";

/** Which account each kind of movement takes from and which it pays into. */
const MOVEMENT_FLOW: Record<MovementKind, readonly [Account, Account]> = {
  opening_grant: ["funding", "available"],
  top_up: ["funding", "available"],
  reserve: ["available", "reserved"],
  settle: ["reserved", "settled"],
  release: ["reserved", "available"],
};

interface MovementInput {
  teamId: string;
  kind: MovementKind;
  amount: bigint;
  at: Date;
  jobId?: string;
  topupId?: string;
  kbInvoiceId?: string;
}

export async function postMovement(db: Db, movement: MovementInput): Promise<void> {
  const [minus, plus] = MOVEMENT_FLOW[movement.kind];
  const created = await single<{ number: bigint }>(db,
    `INSERT INTO movements (number, id, team_id, kind, created_at, job_id, topup_id, kb_invoice_id)
     SELECT n, 'mv_' || n, $1, $2, $3, $4, $5, $6 FROM nextval('movement_number') AS n RETURNING number`,
    [movement.teamId, movement.kind, movement.at, movement.jobId ?? null, movement.topupId ?? null,
      movement.kbInvoiceId ?? null]);
  await db.query(
    "INSERT INTO entries (movement_number, account, amount_micro) VALUES ($1, $2, $3), ($1, $4, $5)",
    [created.number, minus, -movement.amount, plus, movement.amount]);
}

interface Balances {
  granted_micro: bigint;
  available_micro: bigint;
  reserved_micro: bigint;
  settled_micro: bigint;
}

/** Every balance is the sum of its entries; granted is the negated funding balance. */
export async function balances(db: Db, teamId: string): Promise<Balances> {
  const sums = await rows<{ account: Account; total: bigint }>(db,
    `SELECT e.account, SUM(e.amount_micro)::bigint AS total FROM entries e
     JOIN movements m ON m.number = e.movement_number WHERE m.team_id = $1 GROUP BY e.account`, [teamId]);
  const of = (account: Account): bigint => sums.find((s) => s.account === account)?.total ?? 0n;
  return {
    granted_micro: -of("funding"),
    available_micro: of("available"),
    reserved_micro: of("reserved"),
    settled_micro: of("settled"),
  };
}
