import type pg from "pg";
import { ApiError } from "../errors.js";
import { one } from "../db.js";

const SEND_LIMIT = 20;
const WINDOW_SECONDS = 60;

// The send rate, counted from stored messages: the person's own surviving messages stored
// through the send endpoint with sent_at in the 60 seconds up to the moment the send arrived (or later, for sends stored meanwhile).
export async function checkSendRate(db: pg.Pool | pg.PoolClient, authorId: string, at: Date): Promise<void> {
  const row = await one<{ held: number; oldest: Date | null }>(
    db,
    `SELECT count(*)::int AS held, min(sent_at) AS oldest FROM messages
      WHERE author_id = $1 AND via_send AND deleted_at IS NULL
        AND sent_at > $2::timestamptz - interval '60 seconds'`,
    [authorId, at],
  );
  if (!row || row.held < SEND_LIMIT || !row.oldest) return;
  const wait = Math.max(1, Math.floor((row.oldest.getTime() + WINDOW_SECONDS * 1000 - at.getTime()) / 1000) + 1);
  throw new ApiError("rate_limited", { headers: { "Retry-After": String(wait) } });
}
