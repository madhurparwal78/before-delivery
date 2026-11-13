/**
 * Idempotency keys for close and cancel. A repeated key from the same person on the same endpoint,
 * request and body returns the stored response with no new effect; the same key for anything else
 * is idempotency_key_reused. The first response is stored whatever it was, a refusal included.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { one } from "./db.js";
import { ApiError } from "./errors.js";
import type { Reply } from "./http.js";

const KEY_PATTERN = /^[\x21-\x7e]{1,64}$/;

/** The validation message for a missing or malformed Idempotency-Key, or null when it is usable. */
export function keyProblem(key: string | undefined): string | null {
  return key !== undefined && KEY_PATTERN.test(key) ? null : "Send an Idempotency-Key of 1 to 64 visible ASCII characters.";
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

export function fingerprint(endpoint: string, requestId: string, rawBody: Buffer): string {
  let body: string;
  try {
    body = JSON.stringify(canonical(JSON.parse(rawBody.toString("utf8") || "{}")));
  } catch {
    body = rawBody.toString("base64");
  }
  return createHash("sha256").update(`${endpoint}\n${requestId}\n${body}`).digest("hex");
}

interface StoredRow {
  fingerprint: string;
  status_code: number;
  response: string;
}

/** The stored reply for a replayed key, or null for a fresh one. */
export async function replayed(client: pg.PoolClient, personId: string, key: string | undefined, print: string): Promise<Reply | null> {
  if (keyProblem(key) !== null) return null;
  // Concurrent attempts with one person's key, on any request, wait for each other here.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${personId}:${key}`]);
  const stored = await one<StoredRow>(
    client,
    "SELECT fingerprint, status_code, response FROM idempotency_keys WHERE person_id = $1 AND key = $2",
    [personId, key],
  );
  if (!stored) return null;
  if (stored.fingerprint !== print) {
    throw new ApiError("idempotency_key_reused", "This Idempotency-Key was already used for a different action.");
  }
  return { status: stored.status_code, json: JSON.parse(stored.response) };
}

export async function remember(client: pg.PoolClient, personId: string, key: string, print: string, reply: Reply): Promise<void> {
  await client.query(
    "INSERT INTO idempotency_keys (person_id, key, fingerprint, status_code, response) VALUES ($1, $2, $3, $4, $5)",
    [personId, key, print, reply.status, JSON.stringify(reply.json)],
  );
}
