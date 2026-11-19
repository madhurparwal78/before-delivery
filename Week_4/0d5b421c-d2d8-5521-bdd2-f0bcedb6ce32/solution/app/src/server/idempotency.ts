// Idempotent replay for confirm, cancel, claim and walk-in, handled here once for all four.
// The fingerprint follows kit/modules/idempotency: sha256 of METHOD, path and canonical JSON body.
import { createHash } from "node:crypto";
import { pool, rows, withSharedLock } from "./db.js";
import { ApiError, apiErrors, errorBody } from "./errors.js";
import { exclusively } from "./locks.js";

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, nested: unknown) =>
    nested !== null && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : nested,
  );
}

function fingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method.toUpperCase()}\n${path}\n${canonicalJson(body)}`).digest("hex");
}

/** Final means a 2xx, or a 4xx produced after the key was accepted, except 402. */
function isFinal(status: number): boolean {
  return status < 300 || (status >= 400 && status < 500 && status !== 402);
}

async function toReply(work: () => Promise<Reply>): Promise<Reply> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, body: errorBody(error) };
    throw error;
  }
}

export async function runIdempotent(
  key: string,
  method: string,
  path: string,
  body: unknown,
  work: () => Promise<Reply>,
): Promise<Reply> {
  const name = `key:${key}`;
  return exclusively(name, () => withSharedLock(name, async () => {
    const print = fingerprint(method, path, body);
    const [stored] = await rows<{ fingerprint: string; status: number; body: unknown }>(
      pool,
      "SELECT fingerprint, status, body FROM idempotency_records WHERE key = $1 AND created_at > now() - interval '24 hours'",
      [key],
    );
    if (stored !== undefined) {
      if (stored.fingerprint !== print) throw apiErrors.idempotencyConflict();
      return { status: stored.status, body: stored.body };
    }
    const reply = await toReply(work);
    if (isFinal(reply.status)) {
      await pool.query(
        `INSERT INTO idempotency_records (key, fingerprint, status, body) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET fingerprint = $2, status = $3, body = $4, created_at = now()
         WHERE idempotency_records.created_at <= now() - interval '24 hours'`,
        [key, print, reply.status, JSON.stringify(reply.body ?? null)],
      );
    }
    return reply;
  }));
}

export async function purgeIdempotencyRecords(): Promise<void> {
  await pool.query("DELETE FROM idempotency_records WHERE created_at <= now() - interval '24 hours'");
}
