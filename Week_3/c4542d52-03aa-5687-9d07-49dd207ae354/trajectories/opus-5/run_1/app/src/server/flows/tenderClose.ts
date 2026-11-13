import type { Transaction } from "../db.js";
import { allocateTender } from "../domain/allocation.js";
import type { Emit } from "../live/events.js";
import { loadSubmissions, proceedsCents, type TenderRow } from "../model/tenders.js";
import { TENDER_AUDIENCE } from "./audiences.js";
import { addShares, emitCapTable, writeLedgerEntry } from "./ledger.js";

const BUYER_ID = "PER-011";

/** Closes the tender at its close time and moves the allocated shares on the ledger. */
export async function closeAndAllocate(tx: Transaction, emit: Emit, tender: TenderRow, now: Date): Promise<void> {
  await tx.query("update tenders set state = 'closed' where id = $1", [tender.id]);
  await emit("tender_closed", { tender_id: tender.id }, TENDER_AUDIENCE);

  const submissions = await loadSubmissions(tx, tender.id);
  const allocation = allocateTender(
    submissions.map((submission) => ({
      holderId: submission.person_id,
      shares: submission.shares,
      sequence: submission.sequence,
    })),
    tender.share_cap,
  );
  for (const submission of submissions) {
    const allocated = allocation.get(submission.person_id) ?? 0;
    const proceeds = proceedsCents(allocated, tender.price_per_share);
    await tx.query(
      "update tender_submissions set allocation = $3, proceeds_cents = $4 where tender_id = $1 and person_id = $2",
      [tender.id, submission.person_id, allocated, Number(proceeds)],
    );
    if (allocated === 0) continue;
    const holding = await tx.queryOne<{ share_class: string }>(
      "select share_class from holdings where person_id = $1 and shares > 0 order by shares desc limit 1",
      [submission.person_id],
    );
    const shareClass = holding === null ? "Common" : holding.share_class;
    await addShares(tx, submission.person_id, shareClass, -allocated);
    await addShares(tx, BUYER_ID, shareClass, allocated);
    await writeLedgerEntry(tx, {
      at: now,
      holderId: submission.person_id,
      kind: "tender_transfer",
      shareClass,
      sharesDelta: -allocated,
      reference: tender.id,
    });
    await writeLedgerEntry(tx, {
      at: now,
      holderId: BUYER_ID,
      kind: "tender_transfer",
      shareClass,
      sharesDelta: allocated,
      reference: tender.id,
    });
  }
  await tx.query("update tenders set state = 'allocated' where id = $1", [tender.id]);
  await emit("tender_allocated", { tender_id: tender.id }, TENDER_AUDIENCE);
  await emitCapTable(emit);
}
