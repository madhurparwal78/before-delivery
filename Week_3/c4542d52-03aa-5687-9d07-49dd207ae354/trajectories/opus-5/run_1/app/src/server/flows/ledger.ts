import type { LedgerKind } from "../../shared/types.js";
import type { Transaction } from "../db.js";
import { nextLedgerId } from "../ids.js";
import type { Emit } from "../live/events.js";

export interface LedgerWrite {
  at: Date;
  holderId: string | null;
  kind: LedgerKind;
  shareClass?: string | null;
  sharesDelta?: number;
  optionsDelta?: number;
  reference?: string | null;
}

/** One ledger entry per holder affected, written in the same transaction as the change. */
export async function writeLedgerEntry(tx: Transaction, write: LedgerWrite): Promise<string> {
  const id = await nextLedgerId(tx);
  await tx.query(
    `insert into ledger_entries (id, at, holder_id, kind, share_class, shares_delta, options_delta, reference)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      write.at,
      write.holderId,
      write.kind,
      write.shareClass ?? null,
      write.sharesDelta ?? 0,
      write.optionsDelta ?? 0,
      write.reference ?? null,
    ],
  );
  return id;
}

export async function addShares(tx: Transaction, personId: string, shareClass: string, delta: number): Promise<void> {
  await tx.query(
    `insert into holdings (person_id, share_class, shares) values ($1, $2, $3)
     on conflict (person_id, share_class) do update set shares = holdings.shares + excluded.shares`,
    [personId, shareClass, delta],
  );
}

export async function emitCapTable(emit: Emit): Promise<void> {
  await emit("cap_table", {}, { all: true });
}
