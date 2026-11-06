// The share-count ledger. The diluted share count in effect on a date is the
// opening count plus the signed shares of every event belonging to the
// restatement of each week that was current at the instant in question.

import type { PoolClient } from "pg";

export const OPENING_DILUTED_SHARES = "148250000";

/**
 * The diluted share count in effect on `dateStr`, as known at `asOf`: only
 * events of the restatement of each week current at that instant count.
 */
export async function dilutedSharesOnDate(
  client: PoolClient,
  dateStr: string,
  asOf: number | null,
): Promise<string> {
  const { rows } = await client.query(
    `WITH current_weeks AS (
       SELECT DISTINCT ON (week_ending) id FROM restatements
        WHERE state IN ('published','superseded') AND published_at IS NOT NULL
          AND ($2::bigint IS NULL OR published_at <= $2)
        ORDER BY week_ending, published_at DESC
     )
     SELECT COALESCE(SUM(e.signed_shares::bigint), 0) AS total
       FROM share_count_events e
       JOIN current_weeks w ON w.id = e.restatement_id
      WHERE e.effective_date <= $1`,
    [dateStr, asOf === null ? null : String(asOf)],
  );
  const total = BigInt(rows[0]?.total ?? 0);
  return (BigInt(OPENING_DILUTED_SHARES) + total).toString();
}

export interface DraftEvent {
  effective_date: string;
  shares: string;
  kind: string;
}

function priorSundayOf(weekMonday: string): string {
  const d = new Date(Date.UTC(
    Number(weekMonday.slice(0, 4)),
    Number(weekMonday.slice(5, 7)) - 1,
    Number(weekMonday.slice(8, 10)) - 1,
  ));
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}-${d.getUTCDate().toString().padStart(2, "0")}`;
}

/**
 * The share count a draft's `diluted-shares` row must show: the count in
 * effect at the start of the draft's week, with the draft's events applied in
 * effective-date order (ties in request order). A correction leaves out the
 * superseded restatement's events because those effective dates fall inside
 * the draft's own week and so never enter the base count.
 */
export async function draftShareCount(
  client: PoolClient,
  weekMonday: string,
  events: DraftEvent[],
): Promise<{ count: string | null; failedIndex: number | null }> {
  const base = await dilutedSharesOnDate(client, priorSundayOf(weekMonday), null);
  let count = BigInt(base);

  const sorted = events
    .map((e, index) => ({ ...e, index }))
    .sort((a, b) => {
      if (a.effective_date < b.effective_date) return -1;
      if (a.effective_date > b.effective_date) return 1;
      return a.index - b.index;
    });
  for (const ev of sorted) {
    const amount = BigInt(ev.shares);
    const delta = ev.kind === "buyback" ? -amount : amount;
    if (count + delta <= 0n) return { count: null, failedIndex: ev.index };
    count += delta;
  }
  return { count: count.toString(), failedIndex: null };
}

/** Signs a draft event's shares for storage at publication time. */
export function signedShares(event: { kind: string; shares: string }): string {
  const amount = BigInt(event.shares);
  return (event.kind === "buyback" ? -amount : amount).toString();
}
