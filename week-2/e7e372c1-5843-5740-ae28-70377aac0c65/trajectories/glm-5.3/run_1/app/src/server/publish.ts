// Publication: applying a restatement's share events to the ledger, marking
// supersessions, storing the four figure computations and writing the
// publication's audit entry. Called by the release path and by close
// processing for queued releases.

import type { PoolClient } from "pg";
import { nyDateString } from "./nytime.js";
import { sessionForDate, shiftDate } from "./calendar.js";
import { dilutedSharesOnDate, draftShareCount, signedShares } from "./ledger.js";
import { writeAudit } from "./audit.js";
import {
  storeMnav,
  storePublicationComputations,
  markComputationsRestated,
  type PublishedRestatementData,
} from "./computations.js";
import { latestEthTick } from "./ticks.js";
import { resolveSharePrice, resolveSharePriceAtClose, type SharePriceInput } from "./close.js";

export async function publishRestatement(client: PoolClient, id: string, publishedAt: number): Promise<void> {
  const { rows } = await client.query(`SELECT * FROM restatements WHERE id = $1 FOR UPDATE`, [id]);
  if (rows.length === 0) return;
  const r = rows[0];
  if (r.state !== "queued" && r.state !== "cleared") return;

  const { rows: eventRows } = await client.query(
    `SELECT kind, shares, effective_date FROM share_events WHERE restatement_id = $1 ORDER BY position`,
    [id],
  );
  const events = eventRows.map((e) => ({
    kind: e.kind as string,
    shares: e.shares as string,
    effective_date: e.effective_date as string,
  }));

  // 1. Apply share events to the ledger.
  let position = 0;
  for (const ev of events) {
    await client.query(
      `INSERT INTO share_count_events (restatement_id, effective_date, signed_shares, position)
       SELECT $1, $2, $3, $4
        WHERE NOT EXISTS (SELECT 1 FROM share_count_events WHERE restatement_id = $1 AND position = $4)`,
      [id, ev.effective_date, signedShares(ev), position],
    );
    position += 1;
  }

  // 2. For a correction, mark the superseded restatement superseded. Its
  //    ledger events stop counting because its state is no longer published.
  if (r.supersedes !== null) {
    const supersededResult = await client.query(
      `UPDATE restatements SET state = 'superseded', superseded_by = $2, version = version + 1, updated_at = $3
        WHERE id = $1 AND state = 'published'
        RETURNING id, version`,
      [r.supersedes, id, String(publishedAt)],
    );
    if (supersededResult.rows.length > 0) {
      await writeAudit(
        client,
        r.supersedes,
        supersededResult.rows[0].version as number,
        "supersede",
        null,
        publishedAt,
        "published",
        "superseded",
        r.correction_reason as string | null,
      );
    }
  }

  // 3. The diluted share count in effect on the week-ending date, with this
  //    restatement's own events applied (its row is not yet published).
  const weekMonday = shiftDate(r.week_ending as string, -6);
  const ownCount = await draftShareCount(client, weekMonday, events);
  const dilutedShares =
    ownCount.count ?? (await dilutedSharesOnDate(client, r.week_ending as string, publishedAt));

  const computationData: PublishedRestatementData = {
    id,
    weekEnding: r.week_ending as string,
    rows: {
      "beginning-balance": r.rows_beginning_balance as string | null,
      "eth-acquired": r.rows_eth_acquired as string | null,
      "staking-rewards": r.rows_staking_rewards as string | null,
      "ending-balance": r.rows_ending_balance as string | null,
      "cumulative-staking-rewards": r.rows_cumulative_staking_rewards as string | null,
      "diluted-shares": dilutedShares,
    },
    accession: r.accession as string,
    exhibitSha256: r.exhibit_sha256 as string,
    exhibitPage: r.exhibit_page as number,
    dilutedShares,
  };
  await storePublicationComputations(client, computationData, publishedAt);

  const sharePrice = await resolveSharePriceAtPublic(publishedAt);
  const ethTick = await latestEthTick(client);
  if (sharePrice && ethTick) {
    await storeMnav(
      client,
      {
        endingBalance: computationData.rows["ending-balance"] ?? "0",
        dilutedShares,
        sharePrice: sharePrice.price,
        sharePriceSource: sharePrice.source,
        sharePriceLabel: sharePrice.label,
        sharePriceAsOf: sharePrice.asOf,
        ethPrice: ethTick.price,
        ethTickId: ethTick.id,
        ethTickAt: ethTick.at,
        restatement: computationData,
      },
      publishedAt,
    );
  }

  // 4. The publication's own change and audit entry, then the superseded
  //    computations' restated marks (which need this publication's ids).
  const newVersion = r.version + 1;
  await client.query(
    `UPDATE restatements SET state = 'published', published_at = $2, version = $3, updated_at = $2
      WHERE id = $1`,
    [id, String(publishedAt), newVersion],
  );
  // A publication at a session close is the server's own step: its actor
  // is null. An out-of-session release publishes with the officer as actor.
  const publishActor = r.state === "queued" ? null : (r.released_by as string | null);
  await writeAudit(
    client,
    id,
    newVersion,
    "publish",
    publishActor,
    publishedAt,
    r.state as "queued" | "cleared",
    "published",
    null,
  );

  if (r.supersedes !== null) {
    await markComputationsRestated(client, r.supersedes, {
      publishedAt,
      reason: (r.correction_reason as string | null) ?? "",
      correctionId: id,
    });
  }
}

/** A publication's share-price input, whether it publishes at a close or not. */
async function resolveSharePriceAtPublic(atMs: number): Promise<SharePriceInput | null> {
  const date = nyDateString(atMs);
  const session = sessionForDate(date);
  if (session && session.tradingDay && session.closeAt !== null && atMs === session.closeAt) {
    return resolveSharePriceAtClose(session.closeAt, date);
  }
  return resolveSharePrice(atMs);
}
