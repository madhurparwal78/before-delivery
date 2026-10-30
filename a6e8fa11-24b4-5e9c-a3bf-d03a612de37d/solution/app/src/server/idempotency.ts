// Request keys (API · Request keys), adapted from kit/modules/idempotency: the key row is claimed inside
// the effect's transaction, a repeat returns the stored response byte for byte, a different body is 409.
import { createHash } from "node:crypto";
import { type Db, type Tx, tx } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { type Reply, type Request } from "./http.js";

const KEY = /^[\x20-\x7e]{8,128}$/;

export function requestKey(req: Request): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !KEY.test(key)) {
    throw invalid({ "Idempotency-Key": "Send a key of 8 to 128 printable characters." });
  }
  return key;
}

/** JSON with object keys sorted at every depth: key order in a body never changes its fingerprint. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function fingerprint(...parts: Array<string | Buffer>): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p).update("\n");
  return h.digest("hex");
}

/** Returns the stored response for this key, a 409 for a different body under it, or null when it is new. */
export async function replay(db: Db, scope: string, key: string, fp: string): Promise<Reply | null> {
  const r = await db.query<{ fingerprint: string; status: number; body: string }>(
    "SELECT fingerprint, status, body FROM request_keys WHERE scope = $1 AND key = $2",
    [scope, key],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.fingerprint !== fp) throw new ApiError(409, "idempotency_key_reused", "That request key was already used for a different request.");
  return { status: row.status, rawJson: row.body };
}

class AlreadyClaimed extends Error {}

/**
 * Runs `work` once per key. Concurrent requests with the same key wait on the key row; the losers
 * return the winner's stored response.
 */
export async function once(
  db: Db,
  scope: string,
  key: string,
  fp: string,
  work: (t: Tx) => Promise<{ status: number; body: unknown }>,
): Promise<Reply & { fresh: boolean }> {
  try {
    return await tx(db, async (t) => {
      const claimed = await t.query(
        "INSERT INTO request_keys (scope, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key",
        [scope, key, fp],
      );
      if (claimed.rowCount === 0) throw new AlreadyClaimed();
      const result = await work(t);
      const body = JSON.stringify(result.body);
      await t.query("UPDATE request_keys SET status = $3, body = $4 WHERE scope = $1 AND key = $2", [scope, key, result.status, body]);
      return { status: result.status, rawJson: body, fresh: true };
    });
  } catch (error) {
    if (!(error instanceof AlreadyClaimed)) throw error;
    return { ...((await replay(db, scope, key, fp)) as Reply), fresh: false };
  }
}
