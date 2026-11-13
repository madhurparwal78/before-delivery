import { createHash } from "node:crypto";
import { Refusal } from "./errors.js";
import { one, type Db } from "./db.js";
import type { Reply } from "./http.js";

const KEY_LENGTH = { min: 1, max: 100 };

/** JSON with object keys sorted at every depth and no whitespace. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}

function fingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method}\n${path}\n${canonicalJson(body)}`).digest("hex");
}

interface Keyed {
  key: string;
  fingerprint: string;
}

/** The key of a request, when the header is a valid 1 to 100 character key. */
export function keyOf(header: string | undefined, method: string, path: string, body: unknown): Keyed | undefined {
  if (header === undefined || header.length < KEY_LENGTH.min || header.length > KEY_LENGTH.max) return undefined;
  return { key: header, fingerprint: fingerprint(method, path, body) };
}

/** Error order step 4: a key already used answers with its stored response, or refuses a changed request. */
export async function storedReply(db: Db, userId: string, keyed: Keyed | undefined): Promise<Reply | undefined> {
  if (!keyed) return undefined;
  const stored = await one<{ fingerprint: string; status: number; body: unknown }>(
    db,
    "SELECT fingerprint, status, body FROM idempotency_keys WHERE user_id = $1 AND key = $2",
    [userId, keyed.key],
  );
  if (!stored) return undefined;
  if (stored.fingerprint !== keyed.fingerprint) throw Refusal.idempotencyKeyReused();
  return { status: stored.status, body: stored.body };
}

export async function remember(db: Db, userId: string, keyed: Keyed | undefined, result: Reply): Promise<void> {
  if (!keyed) return;
  await db.query("INSERT INTO idempotency_keys (user_id, key, fingerprint, status, body) VALUES ($1, $2, $3, $4, $5)", [
    userId,
    keyed.key,
    keyed.fingerprint,
    result.status,
    JSON.stringify(result.body),
  ]);
}

export async function forgetOld(db: Db): Promise<void> {
  await db.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '48 hours'");
}
