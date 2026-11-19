// Request keys: one answer per key and body, replayed byte for byte, across every app copy.
import { config } from "./config.js";
import { type Db, one, pool } from "./db.js";
import { ApiError, validationFailed } from "./errors.js";
import { canonicalJson } from "./json.js";
import type { SessionUser } from "./auth.js";

const KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const STALE_IN_PROGRESS_MS = 60_000;

export interface Answer {
  status: number;
  text: string;
}

export function readRequestKey(header: string | undefined): string {
  if (header === undefined || !KEY_PATTERN.test(header)) {
    throw validationFailed({ request_key: "Send a Request-Key of 8 to 64 letters, digits and hyphens." });
  }
  return header;
}

interface KeyRow {
  body: unknown;
  state: "in_progress" | "done";
  status: number | null;
  response: string | null;
  created_at: Date;
}

export interface KeyHandle {
  /** Shops the answer in the caller's own transaction, so the effect and its answer commit together. */
  complete(db: Db, answer: Answer): Promise<void>;
}

async function claim(user: SessionUser, key: string, body: unknown, now: Date): Promise<"owner" | KeyRow> {
  const ttlStart = new Date(now.getTime() - config.requestKeyTtlSeconds * 1000);
  for (;;) {
    const inserted = await pool.query(
      "INSERT INTO request_keys (user_id, key, body, state, created_at) VALUES ($1, $2, $3, 'in_progress', $4) ON CONFLICT DO NOTHING",
      [user.id, key, JSON.stringify(body), now]);
    if (inserted.rowCount === 1) return "owner";
    const row = await one<KeyRow>(pool, "SELECT body, state, status, response, created_at FROM request_keys WHERE user_id = $1 AND key = $2", [user.id, key]);
    if (!row) continue;
    if (row.created_at < ttlStart) {
      await pool.query("DELETE FROM request_keys WHERE user_id = $1 AND key = $2 AND created_at < $3", [user.id, key, ttlStart]);
      continue;
    }
    if (row.state === "in_progress" && row.created_at.getTime() < now.getTime() - STALE_IN_PROGRESS_MS && canonicalJson(row.body) === canonicalJson(body)) {
      const taken = await pool.query(
        "UPDATE request_keys SET created_at = $3 WHERE user_id = $1 AND key = $2 AND state = 'in_progress' AND created_at = $4",
        [user.id, key, now, row.created_at]);
      if (taken.rowCount === 1) return "owner";
      continue;
    }
    return row;
  }
}

/**
 * Runs `run` once per (account, key). A repeat with the same body gets the stored answer,
 * a different body gets request_key_reuse, and a repeat still being processed gets request_in_progress.
 * Answers of 500 and above are not stored, so a retry can succeed.
 */
export async function withRequestKey(user: SessionUser, key: string, body: unknown, now: Date,
  run: (handle: KeyHandle) => Promise<Answer>): Promise<Answer> {
  const claimed = await claim(user, key, body, now);
  if (claimed !== "owner") {
    if (canonicalJson(claimed.body) !== canonicalJson(body)) throw new ApiError(409, "request_key_reuse");
    if (claimed.state === "done" && claimed.status !== null && claimed.response !== null) return { status: claimed.status, text: claimed.response };
    throw new ApiError(409, "request_in_progress");
  }
  let completed = false;
  const handle: KeyHandle = {
    async complete(db, answer) {
      await db.query("UPDATE request_keys SET state = 'done', status = $3, response = $4 WHERE user_id = $1 AND key = $2", [user.id, key, answer.status, answer.text]);
      completed = true;
    },
  };
  try {
    const answer = await run(handle);
    if (answer.status >= 500) {
      await pool.query("DELETE FROM request_keys WHERE user_id = $1 AND key = $2", [user.id, key]);
    } else if (!completed) {
      await pool.query("UPDATE request_keys SET state = 'done', status = $3, response = $4 WHERE user_id = $1 AND key = $2", [user.id, key, answer.status, answer.text]);
    }
    return answer;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      const answer = { status: error.status, text: JSON.stringify(error.body) };
      await pool.query("UPDATE request_keys SET state = 'done', status = $3, response = $4 WHERE user_id = $1 AND key = $2", [user.id, key, answer.status, answer.text]);
    } else {
      await pool.query("DELETE FROM request_keys WHERE user_id = $1 AND key = $2", [user.id, key]);
    }
    throw error;
  }
}
