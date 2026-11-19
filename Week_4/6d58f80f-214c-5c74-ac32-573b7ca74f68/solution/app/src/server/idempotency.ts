// Idempotency keys (adapted from kit/modules/idempotency): a repeated key from the same person with the same body
// returns the stored response; the same key with another body is refused (brief: Moves, Idempotency).
import type pg from "pg";
import { createHash } from "node:crypto";
import { first, type Db } from "./db.js";
import { conflict, invalid } from "./http.js";
import { now } from "./clock.js";

function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

function fingerprint(scope: string, body: unknown): string {
  return createHash("sha256").update(`${scope}\n${canonicalJson(body)}`).digest("hex");
}

interface Stored {
  status: number;
  body: unknown;
}

/** The `Idempotency-Key` header, 1–100 characters, or null when absent. */
export function keyOf(header: string | string[] | undefined): string | null {
  if (header === undefined) return null;
  const key = Array.isArray(header) ? header[0] ?? "" : header;
  if (key.length < 1 || key.length > 100) throw invalid({ idempotencyKey: "Use a key of 1 to 100 characters." });
  return key;
}

/** Step 6 of the check order: the stored response for a repeated key, a 409 for a reused one, or null. */
export async function replay(db: Db, personId: string, scope: string, key: string | null, body: unknown): Promise<Stored | null> {
  if (key === null) return null;
  const stored = await first<{ fingerprint: string; status: number; body: unknown }>(db,
    "SELECT fingerprint, status, body FROM idempotency_keys WHERE person_id = $1 AND scope = $2 AND key = $3",
    [personId, scope, key]);
  if (!stored) return null;
  if (stored.fingerprint !== fingerprint(scope, body)) throw conflict("idempotency_key_reused");
  return { status: stored.status, body: stored.body };
}

/** Saves the response in the same transaction as the effect; a concurrent duplicate loses on the primary key. */
export async function remember(client: pg.PoolClient, personId: string, scope: string, key: string | null, body: unknown, response: Stored): Promise<void> {
  if (key === null) return;
  await client.query(
    "INSERT INTO idempotency_keys (person_id, scope, key, fingerprint, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [personId, scope, key, fingerprint(scope, body), response.status, JSON.stringify(response.body), now()]);
}
