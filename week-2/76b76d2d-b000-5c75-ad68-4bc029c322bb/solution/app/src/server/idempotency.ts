import type pg from "pg";
import { one, query } from "./db.ts";
import { ApiError } from "./errors.ts";
import { sha256 } from "./ids.ts";
import { IDEMPOTENCY_KEY } from "./validate.ts";

type Stored = { fingerprint: string; status: number | null; body: string | null };
type Claim = { scope: string; key: string };

/** Keys sorted at every depth, so key order in a body does not change its fingerprint. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Claims an `Idempotency-Key` for the caller (precedence: replay, in progress, conflict, missing key).
 * Returns the stored reply for a replay, otherwise the claim to settle with `remember` or `release`.
 */
export async function claimKey(scope: string, key: string | undefined, path: string, body: unknown): Promise<{ replay: { status: number; body: string } } | { claim: Claim }> {
  const fingerprint = sha256(`POST\n${path}\n${canonical(body)}`);
  if (key !== undefined && IDEMPOTENCY_KEY.test(key)) {
    await query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND created_at < now() - interval '24 hours'", [scope, key]);
    const inserted = await one<{ key: string }>(
      "INSERT INTO idempotency_keys (scope, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key", [scope, key, fingerprint],
    );
    if (inserted) return { claim: { scope, key } };
    const stored = await one<Stored>("SELECT fingerprint, status, body FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key]);
    if (stored && stored.status !== null && stored.body !== null && stored.fingerprint === fingerprint) return { replay: { status: stored.status, body: stored.body } };
    if (stored && stored.status === null) throw new ApiError("idempotency_in_progress");
    throw new ApiError("idempotency_conflict");
  }
  throw new ApiError("validation", {}, { fields: { idempotency_key: { kind: "retry_key" } } });
}

/** Stores the finished response in the same transaction as its effects. */
export async function remember(tx: pg.PoolClient, claim: Claim, status: number, body: unknown): Promise<string> {
  const text = JSON.stringify(body);
  await tx.query("UPDATE idempotency_keys SET status = $3, body = $4 WHERE scope = $1 AND key = $2", [claim.scope, claim.key, status, text]);
  return text;
}

/** A request that did not finish frees its key, so a retry runs for real. */
export async function release(claim: Claim): Promise<void> {
  await query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND status IS NULL", [claim.scope, claim.key]);
}
