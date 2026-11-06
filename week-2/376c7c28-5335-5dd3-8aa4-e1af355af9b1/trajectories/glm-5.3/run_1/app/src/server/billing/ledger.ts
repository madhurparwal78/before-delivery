import type { PoolClient } from "pg";
import { newId } from "../config";
import type { Db } from "../db";
import { q, one } from "../db";
import type { LedgerEntryRow, MovementRow } from "../types";

// Every credit movement posts exactly two opposite entries. A member's balance is
// always the sum of their member_credit entries. Funding decides which accounts a
// fee movement touches — decided in exactly one place (chooseFunding).

export type MovementKind = "opening" | "pack" | "firing_fee" | "storage_fee" | "refund" | "adjustment";
export type Account = "member_credit" | "card_receipts" | "firing_revenue" | "adjustments";
export type Funding = "credit" | "card";

// Charge funding: chosen once, when the first Kill Bill PURCHASE call is sent.
export function chooseFunding(balanceCents: number, feeCents: number, cardStatus: string): Funding {
  if (balanceCents >= feeCents) return "credit";
  if (cardStatus === "on_file") return "card";
  return "credit";
}

export async function balanceOf(db: Db, memberId: string): Promise<number> {
  const row = await one<{ balance: string }>(
    db,
    `SELECT COALESCE(SUM(e.amount_cents), 0) AS balance
       FROM ledger_entries e JOIN movements m ON m.id = e.movement_id
      WHERE e.account = 'member_credit' AND m.member_id = $1`,
    [memberId],
  );
  return Number(row?.balance ?? 0);
}

// Post one movement with its two opposite entries, all in the caller's transaction.
export async function postMovement(
  client: PoolClient,
  args: {
    studioId: string;
    memberId: string;
    kind: MovementKind;
    amountCents: number;
    chargeId?: string;
    purchaseId?: string;
    funding?: Funding;
    at: Date;
  },
): Promise<{ movementId: string; balanceCents: number }> {
  const movementId = newId();
  const kind = args.kind;
  let debit: Account;
  let credit: Account;
  let amount = args.amountCents;
  switch (kind) {
    case "opening":
    case "adjustment":
      debit = "adjustments";
      credit = "member_credit";
      break;
    case "pack":
      debit = "card_receipts";
      credit = "member_credit";
      break;
    case "firing_fee":
    case "storage_fee":
      if (args.funding === "card") {
        debit = "card_receipts";
        credit = "firing_revenue";
      } else {
        debit = "member_credit";
        credit = "firing_revenue";
      }
      break;
    case "refund": {
      const fee = Math.abs(args.amountCents);
      amount = fee;
      if (args.funding === "card") {
        debit = "firing_revenue";
        credit = "card_receipts";
      } else {
        debit = "firing_revenue";
        credit = "member_credit";
      }
      break;
    }
  }
  await client.query(
    `INSERT INTO movements (id, studio_id, member_id, kind, amount_cents, charge_id, purchase_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [movementId, args.studioId, args.memberId, kind, amount, args.chargeId ?? null, args.purchaseId ?? null, args.at],
  );
  // For fees the member's entry is the debit; for refunds/packs/adjustments it is the credit.
  const memberEntryIsDebit = kind === "firing_fee" || kind === "storage_fee";
  const sign = (account: Account): number => {
    if (account === "member_credit") return memberEntryIsDebit ? -amount : amount;
    return account === debit ? -amount : amount;
  };
  for (const account of [debit, credit]) {
    await client.query(
      `INSERT INTO ledger_entries (id, movement_id, account, amount_cents, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [newId(), movementId, account, sign(account), args.at],
    );
  }
  const balance = await balanceOf(client, args.memberId);
  return { movementId, balanceCents: balance };
}

export async function memberEntries(db: Db, memberId: string): Promise<LedgerEntryRow[]> {
  return q<LedgerEntryRow>(
    db,
    `SELECT e.id, e.movement_id, e.account, e.amount_cents, m.kind, m.charge_id, m.member_id AS movement_member_id, e.created_at
       FROM ledger_entries e JOIN movements m ON m.id = e.movement_id
      WHERE m.member_id = $1
      ORDER BY m.created_at ASC, e.created_at ASC, e.id ASC`,
    [memberId],
  );
}

export type MovementList = MovementRow[];
