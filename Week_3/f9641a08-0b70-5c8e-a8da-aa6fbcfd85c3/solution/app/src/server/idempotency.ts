import { createHash } from "node:crypto";
import { fail } from "./errors";
import { one, unit, type Queryable, type Unit } from "./db";

// A completed (2xx) answer is stored against its Idempotency-Key for 24 hours, scoped to the
// signed-in user and the route. Errors roll the unit back, so they are never stored.

function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method}\n${path}\n${canonicalJson(body)}`).digest("hex");
}

export interface Stored {
  status: number;
  text: string;
  replayed: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

interface Row {
  fingerprint: string;
  status: number;
  body: string;
  created_at: Date;
}

/** The stored answer for this key, if any and still fresh; a different body is a mismatch. */
export async function lookupStored(db: Queryable, scope: string, key: string, print: string): Promise<Stored | null> {
  const row = await one<Row>(db, "SELECT fingerprint, status, body, created_at FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key]);
  if (!row || Date.now() - row.created_at.getTime() > DAY_MS) return null;
  if (row.fingerprint !== print) throw fail("idempotency_mismatch");
  return { status: row.status, text: row.body, replayed: true };
}

/**
 * Runs `work` once per key. Concurrent repeats wait on the advisory lock and then replay the stored answer;
 * the answer is stored in the same transaction as the effect it describes.
 */
export async function once(
  scope: string,
  key: string,
  print: string,
  work: (u: Unit) => Promise<{ status: number; body: object }>,
): Promise<Stored> {
  return unit(async (u) => {
    await u.db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${scope}\n${key}`]);
    const stored = await lookupStored(u.db, scope, key, print);
    if (stored) return stored;
    const result = await work(u);
    const text = JSON.stringify(result.body);
    await u.db.query(
      `INSERT INTO idempotency_keys (scope, key, fingerprint, status, body) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (scope, key) DO UPDATE SET fingerprint = $3, status = $4, body = $5, created_at = now()`,
      [scope, key, print, result.status, text],
    );
    return { status: result.status, text, replayed: false };
  });
}
