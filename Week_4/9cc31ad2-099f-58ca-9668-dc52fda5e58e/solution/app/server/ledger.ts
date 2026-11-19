import { randomUUID } from "node:crypto";
import type { Database, Transaction } from "./db.js";
import { Hub } from "./push.js";

type MovementKind = "opening" | "finals" | "pickups" | "result" | "upgrade" | "car" | "refit";

const COUNTER: Readonly<Record<MovementKind, string>> = {
  opening: "house:grants",
  finals: "house:grants",
  pickups: "house:pickups",
  result: "house:results",
  upgrade: "house:shop",
  car: "house:shop",
  refit: "house:refits",
};

export const COUNTER_ACCOUNTS = [...new Set(Object.values(COUNTER))];

export const OPENING_BALANCE = 1000;

export function walletAccount(playerId: string): string {
  return `wallet:${playerId}`;
}

// The balance is the sum of the player's wallet entries, always computed from the ledger.
export async function balanceOf(db: Database | Transaction, playerId: string): Promise<number> {
  const [row] = await db.query<{ total: number }>(
    "SELECT COALESCE(SUM(amount), 0)::int AS total FROM entries WHERE account = $1", [walletAccount(playerId)]);
  return row.total;
}

interface MovementInput {
  readonly playerId: string;
  readonly kind: MovementKind;
  // Signed amount on the wallet; the counter account takes the opposite.
  readonly amount: number;
  readonly runId?: string | null;
  readonly purchaseId?: string | null;
}

// Writes one movement as two entries that sum to zero, then queues the balance push.
// Callers hold the player's lock (Transaction.lockPlayer), so the balance read here is the committed one.
export async function addMovement(tx: Transaction, input: MovementInput): Promise<{ movementId: string; balance: number }> {
  const movementId = randomUUID();
  await tx.query("INSERT INTO movements (id, player_id, kind, run_id, purchase_id) VALUES ($1,$2,$3,$4,$5)",
    [movementId, input.playerId, input.kind, input.runId ?? null, input.purchaseId ?? null]);
  await tx.query("INSERT INTO entries (movement_id, account, amount) VALUES ($1,$2,$3), ($1,$4,$5)",
    [movementId, walletAccount(input.playerId), input.amount, COUNTER[input.kind], -input.amount]);
  const balance = await balanceOf(tx, input.playerId);
  await Hub.queue(tx, { to: input.playerId, push: { type: "balance", balance, movementId, purchaseId: input.purchaseId ?? null } });
  return { movementId, balance };
}

interface LedgerMovement {
  movementId: string;
  kind: MovementKind;
  createdAt: string;
  runId: string | null;
  entries: { account: string; amount: number }[];
}

export async function ledger(db: Database, playerId: string): Promise<{ balance: number; total: number; movements: LedgerMovement[] }> {
  const rows = await db.query<{ id: string; kind: MovementKind; created_at: Date; run_id: string | null; account: string; amount: number }>(
    `SELECT m.id, m.kind, m.created_at, m.run_id, e.account, e.amount
       FROM movements m JOIN entries e ON e.movement_id = m.id
      WHERE m.player_id = $1 ORDER BY m.seq DESC, (e.account LIKE 'wallet:%') DESC`, [playerId]);
  const movements: LedgerMovement[] = [];
  for (const row of rows) {
    let movement = movements[movements.length - 1];
    if (!movement || movement.movementId !== row.id) {
      movement = { movementId: row.id, kind: row.kind, createdAt: row.created_at.toISOString(), runId: row.run_id, entries: [] };
      movements.push(movement);
    }
    movement.entries.push({ account: row.account, amount: row.amount });
  }
  // The ledger total is the same wallet sum as the balance.
  const balance = await balanceOf(db, playerId);
  return { balance, total: balance, movements };
}
