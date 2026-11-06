// Session-close processing: each close is processed exactly once, however many requests, timers
// or app copies see the market clock pass it. The primary key on processed_closes decides.

import { storeMnav } from "./computations.ts";
import { closesPassed } from "./calendar.ts";
import { readMarketClock } from "./clock.ts";
import { database, lockLedger, many, one, text, toTimestamp, withTransaction, type Queryable } from "./db.ts";
import { publishRestatement } from "./publication.ts";
import { findRestatement } from "./restatements.ts";

/** The day before the first seeded session. */
const BEFORE_FIRST_SESSION = "2026-10-11";

async function lastProcessedDate(q: Queryable): Promise<string> {
  const row = await one(q, "SELECT coalesce(max(date)::text, $1) AS date FROM processed_closes", [BEFORE_FIRST_SESSION]);
  return row ? text(row, "date") : BEFORE_FIRST_SESSION;
}

/**
 * Processes one session close exactly once: the primary key on `processed_closes` decides who claims it.
 * Stores the close's mNAV, then publishes any release queued to it. Callers hold the ledger lock.
 */
export async function processClose(q: Queryable, date: string, closeAt: number): Promise<void> {
  const claimed = await one(q, "INSERT INTO processed_closes (date, close_at) VALUES ($1, $2::timestamptz) ON CONFLICT (date) DO NOTHING RETURNING date", [date, toTimestamp(closeAt)]);
  if (!claimed) return;
  await storeMnav(q, closeAt, "close");
  await publishQueuedAt(q, closeAt);
}

/** Processes every unprocessed close at or before `now`, oldest first. Callers hold the ledger lock. */
export async function catchUpCloses(q: Queryable, now: number): Promise<void> {
  for (const day of closesPassed(await lastProcessedDate(q), now)) {
    if (day.closesAt !== null) await processClose(q, day.date, day.closesAt);
  }
}

/** A queued release publishes at its close with that close as its publication time. */
async function publishQueuedAt(q: Queryable, closeAt: number): Promise<void> {
  const queued = await many(q, "SELECT id FROM restatements WHERE state = 'queued' AND release_at <= $1::timestamptz ORDER BY release_at FOR UPDATE", [toTimestamp(closeAt)]);
  for (const row of queued) {
    const restatement = await findRestatement(q, text(row, "id"), true);
    if (restatement && restatement.releaseAt !== null) await publishRestatement(q, restatement, { at: restatement.releaseAt, actorId: null });
  }
}

/** Cheap unlocked look first, so the usual call costs two reads. */
export async function processPassedCloses(): Promise<void> {
  const { now } = await readMarketClock(database());
  if (closesPassed(await lastProcessedDate(database()), now).length === 0) return;
  await withTransaction(async (tx) => {
    await lockLedger(tx);
    await catchUpCloses(tx, (await readMarketClock(tx)).now);
  });
}
