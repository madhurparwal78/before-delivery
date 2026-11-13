import { createHash } from "node:crypto";
import { ApiError } from "./errors.js";
import { query } from "./db.js";

const HOLD_MS = 10 * 60 * 1000;
const RECORD_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[\x21-\x7e]{1,64}$/;

interface Recorded {
  status: number;
  body: unknown;
}

interface IdempotencyScope {
  key: string;
  method: string;
  path: string;
}

export function readKey(header: string | string[] | undefined): string {
  if (typeof header !== "string" || !KEY_PATTERN.test(header)) throw new ApiError("idempotency_key_required");
  return header;
}

export function contentHash(parts: readonly (string | Uint8Array)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    const bytes = typeof part === "string" ? Buffer.from(part) : part;
    hash.update(String(bytes.length)).update(":").update(bytes);
  }
  return hash.digest("hex");
}

interface Row {
  state: "hold" | "done";
  content_hash: string;
  status: number | null;
  body: unknown;
}

/**
 * Takes the hold on a key for its method and path. Returns the recorded success when the
 * same content already succeeded; throws when another request holds the key or the content differs.
 */
export async function takeHold(scope: IdempotencyScope, hash: string): Promise<Recorded | null> {
  const nowMs = Date.now();
  const taken = await query<{ key: string }>(
    `INSERT INTO idempotency_record (key, method, path, state, content_hash, expires_at)
     VALUES ($1, $2, $3, 'hold', $4, $5)
     ON CONFLICT (key, method, path) DO UPDATE
       SET state = 'hold', content_hash = EXCLUDED.content_hash, status = NULL, body = NULL, expires_at = EXCLUDED.expires_at
       WHERE idempotency_record.expires_at < $6
     RETURNING key`,
    [scope.key, scope.method, scope.path, hash, new Date(nowMs + HOLD_MS), new Date(nowMs)],
  );
  if (taken.length > 0) return null;
  const [row] = await query<Row>(
    "SELECT state, content_hash, status, body FROM idempotency_record WHERE key = $1 AND method = $2 AND path = $3",
    [scope.key, scope.method, scope.path],
  );
  if (!row || row.state === "hold") throw new ApiError("idempotency_in_flight");
  if (row.content_hash !== hash) throw new ApiError("idempotency_conflict");
  return { status: row.status ?? 0, body: row.body };
}

/** Replaces the hold with the recorded success. */
export async function recordSuccess(scope: IdempotencyScope, recorded: Recorded): Promise<void> {
  await query(
    `UPDATE idempotency_record SET state = 'done', status = $4, body = $5, expires_at = $6
     WHERE key = $1 AND method = $2 AND path = $3`,
    [scope.key, scope.method, scope.path, recorded.status, JSON.stringify(recorded.body), new Date(Date.now() + RECORD_MS)],
  );
}

/** Any error answer gives the hold back and records nothing. */
export async function releaseHold(scope: IdempotencyScope): Promise<void> {
  await query("DELETE FROM idempotency_record WHERE key = $1 AND method = $2 AND path = $3 AND state = 'hold'", [
    scope.key,
    scope.method,
    scope.path,
  ]);
}
