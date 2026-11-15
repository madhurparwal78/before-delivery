import { createHash } from "node:crypto";
import { IDEMPOTENCY_RETENTION_HOURS } from "./config.js";
import { ApiError } from "./errors.js";
import type { Tx } from "./db.js";
import { pool } from "./db.js";

const KEY_SHAPE = /^[\x21-\x7e]{1,64}$/;

export interface Claim {
  userId: string;
  route: string;
  key: string;
  fingerprint: string;
}

interface Stored {
  status: number;
  response: string;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_name, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}

export function claimFor(userId: string, method: string, path: string, key: string | undefined, body: unknown): Claim | null {
  if (key === undefined || !KEY_SHAPE.test(key)) return null;
  const route = `${method} ${path}`;
  const fingerprint = createHash("sha256").update(`${route}\n${canonicalJson(body)}`).digest("hex");
  return { userId, route, key, fingerprint };
}

function decide(row: { fingerprint: string; status: number | null; response: string | null }, claim: Claim): Stored {
  if (row.fingerprint !== claim.fingerprint) {
    throw new ApiError("idempotency_conflict", "That Idempotency-Key was already used with a different request.");
  }
  return { status: row.status ?? 201, response: row.response ?? "{}" };
}

export async function stored(claim: Claim): Promise<Stored | null> {
  const found = await pool.query<{ fingerprint: string; status: number | null; response: string | null }>(
    "SELECT fingerprint, status, response FROM idempotency_keys WHERE user_id = $1 AND route = $2 AND key = $3 AND status IS NOT NULL AND created_at > now() - make_interval(hours => $4)",
    [claim.userId, claim.route, claim.key, IDEMPOTENCY_RETENTION_HOURS],
  );
  const row = found.rows[0];
  return row ? decide(row, claim) : null;
}

export async function claimInside(tx: Tx, claim: Claim, penId: string | null): Promise<Stored | null> {
  await tx.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND route = $2 AND key = $3 AND created_at <= now() - make_interval(hours => $4)", [
    claim.userId,
    claim.route,
    claim.key,
    IDEMPOTENCY_RETENTION_HOURS,
  ]);
  const inserted = await tx.query(
    "INSERT INTO idempotency_keys (user_id, route, key, fingerprint, pen_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
    [claim.userId, claim.route, claim.key, claim.fingerprint, penId],
  );
  if (inserted.rowCount === 1) return null;
  const found = await tx.query<{ fingerprint: string; status: number | null; response: string | null }>(
    "SELECT fingerprint, status, response FROM idempotency_keys WHERE user_id = $1 AND route = $2 AND key = $3",
    [claim.userId, claim.route, claim.key],
  );
  return decide(found.rows[0] as { fingerprint: string; status: number | null; response: string | null }, claim);
}

export async function remember(tx: Tx, claim: Claim, status: number, response: string): Promise<void> {
  await tx.query("UPDATE idempotency_keys SET status = $4, response = $5 WHERE user_id = $1 AND route = $2 AND key = $3", [
    claim.userId,
    claim.route,
    claim.key,
    status,
    response,
  ]);
}

export function purgeIdempotency(): Promise<unknown> {
  return pool.query("DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(hours => $1)", [IDEMPOTENCY_RETENTION_HOURS]);
}
