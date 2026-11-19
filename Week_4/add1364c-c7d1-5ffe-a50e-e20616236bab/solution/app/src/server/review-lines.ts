import type { Tx } from "./db.js";
import { record, type Actor } from "./audit.js";
import { newId } from "./crypto.js";
import { emitToDesk } from "./events.js";
import { isDesk, type PersonRow } from "./model.js";

export interface ReviewRow {
  id: string;
  ord: number;
  quarter_year: number;
  quarter: number;
  opened_on: string;
  overdue_from: string;
  status: "open" | "overdue" | "signed_off";
  signed_off_by: string | null;
  opened_at: Date;
}

export const quarterLabel = (review: Pick<ReviewRow, "quarter" | "quarter_year">): string =>
  `Q${review.quarter} ${review.quarter_year}`;

export function reviewSubject(review: ReviewRow): { kind: "review"; id: string; name: string } {
  return { kind: "review", id: review.id, name: `${quarterLabel(review)} access review` };
}

async function unsignedReviews(tx: Tx): Promise<ReviewRow[]> {
  return tx.query<ReviewRow>("SELECT * FROM reviews WHERE status <> 'signed_off' ORDER BY ord");
}

function announce(tx: Tx, reviewIds: Iterable<string>): void {
  const ids = [...new Set(reviewIds)];
  if (ids.length === 0) return;
  tx.after(() => ids.forEach((id) => emitToDesk("review-changed", { review_id: id })));
}

/** The person lost the vault: their undecided lines in unsigned reviews close as removed by the scope change. */
export async function closeLines(tx: Tx, person: PersonRow, vaultId: string, vaultName: string, actor: Actor, at: Date): Promise<void> {
  const lines = await tx.query<{ id: string; review_id: string }>(
    `SELECT l.id, l.review_id FROM review_lines l JOIN reviews r ON r.id = l.review_id
     WHERE l.person_id = $1 AND l.vault_id = $2 AND l.decision = 'undecided' AND r.status <> 'signed_off' ORDER BY r.ord`,
    [person.id, vaultId],
  );
  for (const line of lines) {
    await tx.query("UPDATE review_lines SET decision = 'removed', decided_by = NULL, decided_via = 'scope_change' WHERE id = $1", [line.id]);
    const review = await tx.one<ReviewRow>("SELECT * FROM reviews WHERE id = $1", [line.review_id]);
    await record(
      tx,
      actor,
      "review_decision",
      { kind: "person", id: person.id, name: person.full_name },
      { decided_via: "scope_change", decision: "removed", vault: vaultName, review: review ? quarterLabel(review) : null },
      at,
    );
  }
  announce(tx, lines.map((line) => line.review_id));
}

/** A staff accountant or bookkeeper gained vaults: unsigned reviews gain an undecided line for each pair. */
export async function addLines(tx: Tx, person: PersonRow, vaults: Array<{ id: string; name: string }>, actor: Actor, at: Date): Promise<void> {
  if (isDesk(person.role)) return;
  const touched: string[] = [];
  for (const review of await unsignedReviews(tx)) {
    for (const vault of vaults) {
      const existing = await tx.one<{ id: string }>(
        "SELECT id FROM review_lines WHERE review_id = $1 AND person_id = $2 AND vault_id = $3 AND decision = 'undecided'",
        [review.id, person.id, vault.id],
      );
      if (existing) continue;
      await tx.query(
        "INSERT INTO review_lines (id, review_id, person_id, vault_id, decision) VALUES ($1,$2,$3,$4,'undecided')",
        [newId(), review.id, person.id, vault.id],
      );
      await record(
        tx,
        actor,
        "review_line_added",
        { kind: "person", id: person.id, name: person.full_name },
        { vault: vault.name, review: quarterLabel(review) },
        at,
      );
      touched.push(review.id);
    }
  }
  announce(tx, touched);
}

export { announce as announceReviews };
