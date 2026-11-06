// Idempotent bookings and cancellations per account and key (brief: Idempotency), adapted from kit/modules/idempotency.
// The key row is claimed first; a byte-identical duplicate waits for the first to finish, a different body is refused.
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";
import type { Reply } from "./api.js";
import { ApiError } from "./errors.js";

const WAIT_MS = 25;

interface KeyRow {
  fingerprint: string;
  state: "running" | "done";
  status: number | null;
  body: string | null;
}

export async function withIdempotency(
  db: Pool,
  accountId: string,
  key: string,
  raw: Buffer,
  run: () => Promise<Reply>,
): Promise<Reply> {
  const fingerprint = createHash("sha256").update(raw).digest("hex");
  await db.query(
    `DELETE FROM idempotency WHERE created_at < now() - interval '24 hours'
        OR (state = 'running' AND created_at < now() - interval '10 minutes')`,
  );
  for (;;) {
    const claimed = await db.query(
      `INSERT INTO idempotency (account_id, key, fingerprint, state) VALUES ($1, $2, $3, 'running')
       ON CONFLICT DO NOTHING RETURNING 1`,
      [accountId, key, fingerprint],
    );
    if (claimed.rowCount === 1) return runClaimed(db, accountId, key, run);
    const { rows } = await db.query<KeyRow>(
      "SELECT fingerprint, state, status, body FROM idempotency WHERE account_id = $1 AND key = $2",
      [accountId, key],
    );
    const row = rows[0];
    if (!row) continue;
    if (row.fingerprint !== fingerprint) {
      throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
    }
    if (row.state === "done" && row.status !== null && row.body !== null) {
      return { status: row.status, body: row.body, headers: { "Idempotent-Replay": "true" } };
    }
    await sleep(WAIT_MS);
  }
}

async function runClaimed(db: Pool, accountId: string, key: string, run: () => Promise<Reply>): Promise<Reply> {
  let reply: Reply;
  try {
    reply = await run();
  } catch (error) {
    await db.query("DELETE FROM idempotency WHERE account_id = $1 AND key = $2", [accountId, key]);
    throw error;
  }
  if (reply.status !== 201) {
    await db.query("DELETE FROM idempotency WHERE account_id = $1 AND key = $2", [accountId, key]);
    return reply;
  }
  const body = JSON.stringify(reply.body);
  await db.query(
    "UPDATE idempotency SET state = 'done', status = $3, body = $4 WHERE account_id = $1 AND key = $2",
    [accountId, key, reply.status, body],
  );
  return { ...reply, body };
}
