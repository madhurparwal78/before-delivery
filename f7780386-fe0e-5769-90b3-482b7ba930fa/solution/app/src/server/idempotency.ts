// Retry-safe POSTs: the first response under an Idempotency-Key is stored and replayed without repeating effects.

import { createHash } from "node:crypto";
import { now } from "./clock.js";
import { tx } from "./db.js";
import { ApiError, conflict } from "./errors.js";
import type { Reply } from "./http.js";

const KEY_PATTERN = /^[\x20-\x7e]{1,100}$/;
const KEPT_MS = 24 * 3_600_000;

export function validKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function requestHash(method: string, pathWithQuery: string, body: Buffer): string {
  return createHash("sha256").update(`${method}\n${pathWithQuery}\n`).update(body).digest("hex");
}

/** Runs the request once per (user, key); later calls get the stored status and body back. */
export async function idempotent(userId: string, key: string, hash: string, run: () => Promise<Reply>): Promise<Reply> {
  const claimed = await tx(async (db) => {
    await db.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND created_at <= $3", [userId, key, new Date(now() - KEPT_MS)]);
    const inserted = await db.query(
      `INSERT INTO idempotency_keys (user_id, key, request_hash, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
      [userId, key, hash, new Date(now())],
    );
    if (inserted.rowCount === 1) return null;
    const stored = await db.query<{ request_hash: string; completed: boolean; status_code: number | null; response: string | null }>(
      "SELECT request_hash, completed, status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2",
      [userId, key],
    );
    const row = stored.rows[0];
    if (!row) throw conflict("request_in_progress");
    if (row.request_hash !== hash) throw new ApiError(422, { error: "idempotency_key_reused" });
    if (!row.completed) throw conflict("request_in_progress");
    const replay: Reply = { status: row.status_code ?? 200, headers: { "Idempotent-Replay": "true" } };
    if (row.response !== null) {
      replay.body = row.response;
      replay.headers = { ...replay.headers, "Content-Type": "application/json; charset=utf-8" };
    }
    return replay;
  });
  if (claimed) return claimed;
  let reply: Reply;
  try {
    reply = await run();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 500) {
      await tx((db) => db.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key])).catch(() => undefined);
      throw error;
    }
    reply = { status: error.status, body: error.body };
  }
  if (reply.status >= 500) {
    await tx((db) => db.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key]));
    return reply;
  }
  const text = reply.body === undefined ? null : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
  await tx((db) =>
    db.query("UPDATE idempotency_keys SET completed = true, status_code = $3, response = $4 WHERE user_id = $1 AND key = $2", [
      userId,
      key,
      reply.status,
      text,
    ]),
  );
  return text === null ? reply : { ...reply, body: text };
}
