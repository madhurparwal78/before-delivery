// The diluted share count: the opening count plus the signed events of restatements currently published.

import { many, text, type Queryable } from "./db.ts";

const OPENING_SHARES = 148_250_000n;

/** Count in effect before a week: every published event counts, except those of the restatement being corrected. */
export async function sharesBeforeWeek(q: Queryable, excludedRestatementId: string | null): Promise<bigint> {
  const rows = await many(
    q,
    `SELECT e.kind, e.shares FROM share_events e JOIN restatements r ON r.id = e.restatement_id
      WHERE r.state = 'published' AND ($1::uuid IS NULL OR r.id <> $1::uuid)`,
    [excludedRestatementId],
  );
  return rows.reduce((count, row) => {
    const shares = BigInt(text(row, "shares"));
    return text(row, "kind") === "buyback" ? count - shares : count + shares;
  }, OPENING_SHARES);
}
