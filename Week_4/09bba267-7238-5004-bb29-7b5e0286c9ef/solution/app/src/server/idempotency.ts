// Idempotency keys for checkout, exchange, refund and offer accept (adapted from kit/modules/idempotency).
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { pool } from "./db.js";
import { fail, HttpError, type Reply } from "./http.js";

const KEY = /^[\x21-\x7e]{1,100}$/;
export const KEY_MESSAGE = "Send an Idempotency-Key header of 1 to 100 visible characters.";
const STORED = new Set([200, 201, 402]);
const STALE_MS = 120_000;

function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

const fingerprint = (method: string, path: string, body: unknown): string =>
  createHash("sha256").update(`${method}\n${path}\n${canonicalJson(body)}`).digest("hex");

export const validKey = (key: string | null): key is string => key !== null && KEY.test(key);

interface StoredRow {
  fingerprint: string;
  status: number | null;
  body: string | null;
  created_at: Date;
}

/**
 * Runs a keyed request once per (scope, key). A completed 200, 201 or 402 is stored and returned unchanged to
 * every repeat with the same method, path and body; a different request under the key answers 409; a repeat
 * that arrives while the first runs waits for it. Other outcomes are forgotten so the key can be retried.
 * Without a valid key the request runs unstored and its validation reports the key.
 */
export async function keyed(scope: string, key: string | null, method: string, path: string, body: unknown,
  run: () => Promise<Reply>): Promise<Reply> {
  if (!validKey(key)) return run();
  const print = fingerprint(method, path, body);
  for (;;) {
    const claimed = await pool.query(
      "INSERT INTO idempotency_keys (scope, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [scope, key, print]);
    if (claimed.rowCount === 1) break;
    const found = await pool.query<StoredRow>(
      "SELECT fingerprint, status, body, created_at FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key]);
    const stored = found.rows[0];
    if (!stored) continue;
    if (stored.fingerprint !== print) throw fail(409, "idempotency_conflict");
    if (stored.status !== null) return { status: stored.status, body: JSON.parse(stored.body ?? "null") as unknown };
    if (Date.now() - stored.created_at.getTime() > STALE_MS) {
      await pool.query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND status IS NULL", [scope, key]);
      continue;
    }
    await sleep(100);
  }
  let reply: Reply | undefined;
  try {
    reply = await run();
    return reply;
  } catch (error) {
    if (error instanceof HttpError) reply = { status: error.status, body: error.body };
    throw error;
  } finally {
    if (reply && STORED.has(reply.status)) {
      await pool.query("UPDATE idempotency_keys SET status = $3, body = $4 WHERE scope = $1 AND key = $2",
        [scope, key, reply.status, JSON.stringify(reply.body)]);
    } else {
      await pool.query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key]);
    }
  }
}
