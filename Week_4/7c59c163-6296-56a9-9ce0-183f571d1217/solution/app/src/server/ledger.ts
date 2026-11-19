import { randomUUID } from "node:crypto";
import { one, type Db } from "./db.js";

export const account = {
  available: (memberId: string) => `member:${memberId}:available`,
  held: (memberId: string) => `member:${memberId}:held`,
  collateral: (memberId: string) => `member:${memberId}:collateral`,
  cardClearing: "venue:card_clearing",
  fees: "venue:fees",
  insurance: "venue:insurance",
  escrow: (marketId: string) => `venue:escrow:${marketId}`,
  lending: (marketId: string) => `venue:margin_lending:${marketId}`,
};

export type Leg = [account: string, cents: number];

type EntryKind =
  | "deposit"
  | "refund"
  | "hold"
  | "release"
  | "fill"
  | "netting"
  | "payout"
  | "liquidation";

/**
 * Posts one journal entry. Legs on the same account are combined and zero legs dropped; the rest
 * must be at least two legs summing to exactly zero.
 */
export async function post(db: Db, venueId: string, kind: EntryKind, referenceId: string | null, legs: Leg[]): Promise<void> {
  const combined = new Map<string, number>();
  for (const [name, cents] of legs) combined.set(name, (combined.get(name) ?? 0) + cents);
  const kept = [...combined].filter(([, cents]) => cents !== 0);
  if (kept.length === 0) return;
  const sum = kept.reduce((total, [, cents]) => total + cents, 0);
  if (kept.length < 2 || sum !== 0) throw new Error(`unbalanced ${kind} entry: ${JSON.stringify(kept)}`);
  const entryId = randomUUID();
  await db.query("INSERT INTO journal_entries (id, venue_id, kind, reference_id) VALUES ($1, $2, $3, $4)", [entryId, venueId, kind, referenceId]);
  const values: unknown[] = [];
  const tuples = kept.map(([name, cents], i) => {
    values.push(randomUUID(), entryId, venueId, name, cents);
    const b = i * 5;
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
  });
  await db.query(`INSERT INTO journal_legs (id, entry_id, venue_id, account, amount_cents) VALUES ${tuples.join(", ")}`, values);
}

interface Balance {
  available_cents: number;
  held_cents: number;
  collateral_cents: number;
  total_cents: number;
}

export async function balanceOf(db: Db, memberId: string): Promise<Balance> {
  const row = await one<{ available: number; held: number; collateral: number }>(
    db,
    `SELECT coalesce(sum(amount_cents) FILTER (WHERE account = $1), 0) AS available,
            coalesce(sum(amount_cents) FILTER (WHERE account = $2), 0) AS held,
            coalesce(sum(amount_cents) FILTER (WHERE account = $3), 0) AS collateral
       FROM journal_legs WHERE account IN ($1, $2, $3)`,
    [account.available(memberId), account.held(memberId), account.collateral(memberId)],
  );
  const available = row?.available ?? 0;
  const held = row?.held ?? 0;
  const collateral = row?.collateral ?? 0;
  return { available_cents: available, held_cents: held, collateral_cents: collateral, total_cents: available + held + collateral };
}

/** Serialises balance-checked changes for one member (deposit, refund, placement). */
export async function lockMember(db: Db, memberId: string): Promise<void> {
  await db.query("SELECT 1 FROM members WHERE id = $1 FOR NO KEY UPDATE", [memberId]);
}
