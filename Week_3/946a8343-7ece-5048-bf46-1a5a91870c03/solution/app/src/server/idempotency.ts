// Idempotency keys (adapted from kit/modules/idempotency): scoped to the user, kept 24 hours, replay byte for byte.
import { createHash } from "node:crypto";
import { db, withAdvisoryLock } from "./db.ts";
import { now } from "./clock.ts";
import { idempotencyConflict } from "./errors.ts";
import { isRecord } from "./json.ts";

const KEEP_MS = 24 * 3600 * 1000;

function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method}\n${path}\n${canonicalJson(body)}`).digest("hex");
}

function lockKey(userId: number, key: string): number {
  return createHash("sha256").update(`${userId}:${key}`).digest().readInt32BE(0);
}

interface StoredReply {
  readonly status: number;
  readonly body: unknown;
  readonly replay: boolean;
}

// Runs `run` once per (user, key); a replay returns the stored status and body without running it again.
export async function withIdempotency(
  userId: number,
  key: string,
  request: { method: string; path: string; body: unknown },
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<StoredReply> {
  const print = fingerprint(request.method, request.path, request.body);
  return withAdvisoryLock(lockKey(userId, key), async () => {
    const stored = await db.maybe<{ fingerprint: string; status: number; body: string; created_at: number }>(
      "SELECT fingerprint, status, body, created_at FROM idempotency_keys WHERE user_id = $1 AND key = $2",
      [userId, key],
    );
    if (stored !== undefined && stored.created_at > now() - KEEP_MS) {
      if (stored.fingerprint !== print) {
        throw idempotencyConflict();
      }
      return { status: stored.status, body: JSON.parse(stored.body), replay: true };
    }
    const reply = await run();
    await db.q(
      `INSERT INTO idempotency_keys (user_id, key, fingerprint, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, key) DO UPDATE SET fingerprint = $3, status = $4, body = $5, created_at = $6`,
      [userId, key, print, reply.status, JSON.stringify(reply.body ?? null), now()],
    );
    return { ...reply, replay: false };
  });
}
