// Session-close processing and mNAV input resolution. Each trading day's close
// is processed exactly once; queued restatements publish at their release time.

import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { nyDateString } from "./nytime.js";
import { sessionForDate, shiftDate } from "./calendar.js";
import { dilutedSharesOnDate } from "./ledger.js";
import { storeMnav, type PublishedRestatementData } from "./computations.js";
import { latestEthTick, latestOfficialCloseBefore } from "./ticks.js";
import { getClockRow, nowMs, marketNow } from "./clock.js";
import { publishRestatement } from "./publish.js";

const POLL_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Share-price input resolution. The single decision point for what the
// share-price input of a mNAV computation is.

export interface SharePriceInput {
  price: string;
  label: string;
  source: { kind: "tick"; id: string; at: number } | { kind: "official_close"; date: string };
  asOf: number;
}

/**
 * The share price for an mNAV computation at instant `atMs`:
 * during the session, the latest VLCH tick of the day, or the most recent
 * official close if there has been no VLCH tick yet that day; outside the
 * session, the most recent official close.
 */
export async function resolveSharePrice(atMs: number): Promise<SharePriceInput | null> {
  const date = nyDateString(atMs);
  const session = sessionForDate(date);
  const openAt = session?.openAt ?? null;
  const closeAt = session?.closeAt ?? null;
  const inSession =
    session !== null && session.tradingDay && openAt !== null && closeAt !== null
      ? atMs >= openAt && atMs < closeAt
      : false;

  if (inSession && openAt !== null && closeAt !== null) {
    const latestToday = await officialCloseForDateClient(openAt, closeAt, atMs);
    if (latestToday) {
      return {
        price: latestToday.price,
        label: "Share price — last trade",
        source: { kind: "tick", id: latestToday.id, at: latestToday.at },
        asOf: latestToday.at,
      };
    }
    // No VLCH tick yet today: the most recent official close.
    const earlier = openAt !== null ? await latestOfficialCloseBefore(openAt) : null;
    if (!earlier) return null;
    const closeDate = nyDateString(earlier.at);
    return {
      price: earlier.price,
      label: `Official close ${closeDate}`,
      source: { kind: "official_close", date: closeDate },
      asOf: closeInstantFor(closeDate),
    };
  }

  // Outside the session: the most recent official close strictly at or before now.
  const close = await latestOfficialCloseBeforeWithSelf(atMs);
  if (!close) return null;
  const closeDate = nyDateString(close.at);
  return {
    price: close.price,
    label: `Official close ${closeDate}`,
    source: { kind: "official_close", date: closeDate },
    asOf: closeInstantFor(closeDate),
  };
}

/** The share price for a session-close computation: that date's own close when it has one. */
export async function resolveSharePriceAtClose(closeAt: number, closeDate: string): Promise<SharePriceInput | null> {
  const own = await officialCloseForDateClient(0, closeAt, closeAt);
  if (own) {
    return {
      price: own.price,
      label: `Official close ${closeDate}`,
      source: { kind: "official_close", date: closeDate },
      asOf: closeAt,
    };
  }
  const previous = await latestOfficialCloseBefore(closeAt);
  if (!previous) return null;
  const previousDate = nyDateString(previous.at);
  return {
    price: previous.price,
    label: `Official close ${previousDate}`,
    source: { kind: "official_close", date: previousDate },
    asOf: closeInstantFor(previousDate),
  };
}

async function officialCloseForDateClient(
  openAt: number,
  closeAt: number,
  nowMs: number,
): Promise<{ id: string; price: string; at: number } | null> {
  const cap = Math.min(closeAt, nowMs);
  const { rows } = await pool.query(
    `SELECT id, price, at FROM ticks WHERE instrument = 'VLCH' AND at >= $1 AND at <= $2 ORDER BY at DESC LIMIT 1`,
    [String(openAt), String(cap)],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id as string, price: rows[0].price as string, at: Number(rows[0].at) };
}

async function latestOfficialCloseBeforeWithSelf(atMs: number): Promise<{ price: string; at: number } | null> {
  const { rows } = await pool.query(
    `SELECT price, at FROM ticks WHERE instrument = 'VLCH' AND at <= $1 ORDER BY at DESC LIMIT 1`,
    [String(atMs)],
  );
  if (rows.length === 0) return null;
  return { price: rows[0].price as string, at: Number(rows[0].at) };
}

export function closeInstantFor(date: string): number {
  const session = sessionForDate(date);
  if (!session || session.closeAt === null) {
    throw new Error("close instant for a non-trading date");
  }
  return session.closeAt;
}

// ---------------------------------------------------------------------------
// mNAV computations for ticks and closes.

export async function computeMnavForTick(
  client: PoolClient,
  tick: { instrument: string; price: string; id?: string },
  at: number,
): Promise<void> {
  const published = await latestPublishedRestatementData(client, at);
  if (!published) return;

  const ethTick =
    tick.instrument === "ETH-USD"
      ? { price: tick.price, id: tick.id ?? "eth", at }
      : await latestEthTick(client);
  if (!ethTick) return;
  const sharePrice = await resolveSharePrice(at);
  if (!sharePrice) return;

  await storeMnav(client, {
    endingBalance: published.rows["ending-balance"] ?? "0",
    dilutedShares: published.dilutedShares,
    sharePrice: sharePrice.price,
    sharePriceSource: sharePrice.source,
    sharePriceLabel: sharePrice.label,
    sharePriceAsOf: sharePrice.asOf,
    ethPrice: ethTick.price,
    ethTickId: ethTick.id,
    ethTickAt: ethTick.at,
    restatement: published,
  }, at);
}

/**
 * The published restatement as of an instant: the one with the greatest
 * publication time at or before it. Superseded restatements keep their
 * publication times, so they are current for the instants between their own
 * publication and their correction's.
 */
async function latestPublishedRestatementData(
  client: PoolClient,
  asOf: number,
): Promise<PublishedRestatementData | null> {
  const { rows } = await client.query(
    `SELECT id, week_ending, rows_beginning_balance, rows_eth_acquired, rows_staking_rewards,
            rows_ending_balance, rows_cumulative_staking_rewards, rows_diluted_shares,
            accession, exhibit_sha256, exhibit_page
       FROM restatements
      WHERE state IN ('published','superseded') AND published_at IS NOT NULL AND published_at <= $1
      ORDER BY published_at DESC LIMIT 1`,
    [String(asOf)],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const diluted = await dilutedSharesOnDate(client, r.week_ending as string, asOf);
  return {
    id: r.id as string,
    weekEnding: r.week_ending as string,
    rows: {
      "beginning-balance": r.rows_beginning_balance as string | null,
      "eth-acquired": r.rows_eth_acquired as string | null,
      "staking-rewards": r.rows_staking_rewards as string | null,
      "ending-balance": r.rows_ending_balance as string | null,
      "cumulative-staking-rewards": r.rows_cumulative_staking_rewards as string | null,
      "diluted-shares": diluted,
    },
    accession: r.accession as string,
    exhibitSha256: r.exhibit_sha256 as string,
    exhibitPage: r.exhibit_page as number,
    dilutedShares: diluted,
  };
}

// ---------------------------------------------------------------------------
// Session-close processing.

export function startCloseProcessing(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void processDueCloses()
      .then(async () => {
        const now = await marketNow();
        await ensureCloseRowsUpTo(now);
      })
      .catch(() => undefined);
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

/** Processes every unprocessed close the market clock has passed, in date order. */
export async function processDueCloses(): Promise<void> {
  const clockRow = await getClockRow();
  const now = nowMs(clockRow);

  const { rows } = await pool.query(
    `SELECT date, close_at FROM session_closes WHERE processed_at IS NULL AND close_at <= $1 ORDER BY close_at`,
    [String(now)],
  );
  for (const row of rows) {
    await processOneClose(row.date as string, Number(row.close_at), now);
  }

  // A queued release publishes at its release time even when the market clock
  // reached that instant by a backward rehearsal jump after the close itself
  // was processed. The state machine under the row lock keeps it exactly once.
  const { rows: due } = await pool.query(
    `SELECT id FROM restatements WHERE state = 'queued' AND release_at <= $1 ORDER BY release_at`,
    [String(now)],
  );
  for (const row of due) {
    await publishQueuedReleaseAt(row.id as string);
  }
}

async function publishQueuedReleaseAt(id: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ release_at: string }>(
      `SELECT release_at FROM restatements WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const r = rows[0] as { release_at: string | null } | undefined;
    if (!r || r.release_at === null) {
      await client.query("COMMIT");
      return;
    }
    await publishRestatement(client, id, Number(r.release_at));
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function processOneClose(date: string, closeAt: number, now: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Claim the close: the single-row update decides the race.
    const claimed = await client.query(
      `UPDATE session_closes SET processed_at = $2 WHERE date = $1 AND processed_at IS NULL RETURNING date, close_at`,
      [date, String(now)],
    );
    if (claimed.rows.length === 0) {
      await client.query("COMMIT");
      return;
    }

    // 1. The session-close mNAV, if a week had been published by this close.
    const published = await latestPublishedRestatementData(client, closeAt);
    if (published) {
      const sharePrice = await resolveSharePriceAtClose(closeAt, date);
      const ethTick = await latestEthTick(client);
      if (sharePrice && ethTick) {
        await storeMnav(
          client,
          {
            endingBalance: published.rows["ending-balance"] ?? "0",
            dilutedShares: published.dilutedShares,
            sharePrice: sharePrice.price,
            sharePriceSource: sharePrice.source,
            sharePriceLabel: sharePrice.label,
            sharePriceAsOf: sharePrice.asOf,
            ethPrice: ethTick.price,
            ethTickId: ethTick.id,
            ethTickAt: ethTick.at,
            restatement: published,
          },
          closeAt,
        );
      }
    }

    // 2. Publish any restatement queued to this close.
    const { rows: queued } = await client.query(
      `SELECT id FROM restatements WHERE state = 'queued' AND release_at = $1 ORDER BY release_at FOR UPDATE`,
      [String(closeAt)],
    );
    for (const row of queued) {
      await publishRestatement(client, row.id as string, closeAt);
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}



export async function ensureCloseRowsUpTo(nowMs: number): Promise<void> {
  // Fill the session_closes table with every trading day from the first needed
  // date up to the clock's current date, so processing sees them.
  const { rows } = await pool.query<{ earliest: string | null }>(
    `SELECT MIN(date) AS earliest FROM session_closes`,
  );
  let cursor = rows[0]?.earliest ?? "2026-01-01";
  const today = nyDateString(nowMs);
  const existing = new Set(
    (await pool.query<{ date: string }>(`SELECT date FROM session_closes`)).rows.map((r) => r.date),
  );
  while (cursor <= today) {
    if (!existing.has(cursor)) {
      const session = sessionForDate(cursor);
      if (session?.tradingDay && session.closeAt !== null) {
        await pool.query(
          `INSERT INTO session_closes (date, close_at) VALUES ($1, $2) ON CONFLICT (date) DO NOTHING`,
          [cursor, String(session.closeAt)],
        );
      }
    }
    cursor = shiftDate(cursor, 1);
  }
}
