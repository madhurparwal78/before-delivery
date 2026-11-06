// Idempotency-Key handling for every keyed endpoint, in one place.
// The key row is inserted first as an in-progress marker; a 2xx answer is stored with it for good, and any
// other answer (or a thrown error) deletes the marker before the answer is sent, so the key is unused again.

import { createHash } from "node:crypto";
import { pool } from "../db.js";
import { ApiError } from "./errors.js";
import type { Reply } from "./route.js";

/** A marker this old belongs to a process that died mid-request; the key is free again. */
const ABANDONED_AFTER_MS = 120_000;

export function isValidKey(key: string | undefined): key is string {
  return key !== undefined && key.length >= 1 && key.length <= 100;
}

export function fingerprint(method: string, path: string, body: Buffer): string {
  return createHash("sha256").update(`${method}\n${path}\n`).update(body).digest("hex");
}

interface StoredKey {
  fingerprint: string;
  state: "running" | "done";
  status_code: number | null;
  body: string | null;
  started_at: Date;
}

export async function withIdempotency(
  callerId: string,
  key: string,
  print: string,
  now: Date,
  run: () => Promise<Reply>,
): Promise<Reply> {
  for (;;) {
    const claimed = await pool.query(
      `INSERT INTO idempotency_key (caller_id, key, fingerprint, state, started_at)
       VALUES ($1, $2, $3, 'running', $4) ON CONFLICT DO NOTHING`,
      [callerId, key, print, now],
    );
    if (claimed.rowCount === 1) break;
    const found = await pool.query<StoredKey>(
      "SELECT fingerprint, state, status_code, body, started_at FROM idempotency_key WHERE caller_id = $1 AND key = $2",
      [callerId, key],
    );
    const stored = found.rows[0];
    if (!stored) continue;
    if (stored.fingerprint !== print) throw ApiError.of("idempotency_conflict");
    if (stored.state === "done") return { status: stored.status_code ?? 200, json: stored.body ?? "null" };
    if (now.getTime() - stored.started_at.getTime() < ABANDONED_AFTER_MS) throw ApiError.of("request_in_progress");
    await pool.query("DELETE FROM idempotency_key WHERE caller_id = $1 AND key = $2 AND state = 'running' AND started_at = $3", [
      callerId,
      key,
      stored.started_at,
    ]);
  }

  let reply: Reply | undefined;
  try {
    reply = await run();
    return reply;
  } finally {
    if (reply && reply.status >= 200 && reply.status < 300) {
      await pool.query(
        "UPDATE idempotency_key SET state = 'done', status_code = $3, body = $4 WHERE caller_id = $1 AND key = $2",
        [callerId, key, reply.status, reply.json ?? JSON.stringify(reply.body ?? null)],
      );
    } else {
      await pool.query("DELETE FROM idempotency_key WHERE caller_id = $1 AND key = $2 AND state = 'running'", [callerId, key]);
    }
  }
}
