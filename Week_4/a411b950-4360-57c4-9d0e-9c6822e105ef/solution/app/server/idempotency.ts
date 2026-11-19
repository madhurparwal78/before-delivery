// Idempotency-Key handling shared by briefs and deposits: each key lives in its own scope, holds the request's
// fingerprint and, once answered, the stored response.

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { one, query } from "./db.js";
import { errorBody, fail, HttpError, invalid, sendJson } from "./http.js";

const IDEMPOTENCY_KEY = /^[!-~]{1,100}$/;

/** A claim older than this is taken over: its request died without an answer. */
const ABANDONED_AFTER = "2 minutes";

/** The request's Idempotency-Key, or null when an optional header is absent; a malformed or missing required key answers 422. */
export function idempotencyKey(req: IncomingMessage, required: boolean): string | null {
  const key = req.headers["idempotency-key"];
  if (key === undefined && !required) return null;
  if (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key)) {
    invalid({ "Idempotency-Key": "Send an Idempotency-Key of 1 to 100 visible ASCII characters." });
  }
  return key;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** SHA-256 of the value's canonical JSON: key order never changes a fingerprint. */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

type Claim = { kind: "new" } | { kind: "replay"; status: number; body: unknown };

/** Claims the key in its scope, or answers from what the key already holds. */
async function claimKey(scope: string, key: string, print: string): Promise<Claim> {
  const inserted = await one(
    `INSERT INTO idempotency_requests (scope, idempotency_key, fingerprint) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, print],
  );
  if (inserted) return { kind: "new" };
  const held = await one<{ fingerprint: string; status_code: number | null; response: unknown; abandoned: boolean }>(
    `SELECT fingerprint, status_code, response, started_at < now() - interval '${ABANDONED_AFTER}' AS abandoned
     FROM idempotency_requests WHERE scope = $1 AND idempotency_key = $2`,
    [scope, key],
  );
  if (!held) return claimKey(scope, key, print);
  if (held.fingerprint !== print) fail(409, "idempotency_conflict", "This Idempotency-Key was used with a different request.");
  if (held.status_code !== null) return { kind: "replay", status: held.status_code, body: held.response };
  if (held.abandoned) {
    const taken = await one(
      `UPDATE idempotency_requests SET started_at = now() WHERE scope = $1 AND idempotency_key = $2
         AND status_code IS NULL AND started_at < now() - interval '${ABANDONED_AFTER}' RETURNING idempotency_key`,
      [scope, key],
    );
    if (taken) return { kind: "new" };
  }
  fail(409, "request_in_progress", "The first request with this Idempotency-Key is still running.");
}

async function settle(scope: string, key: string, status: number, body: unknown, stored: boolean): Promise<void> {
  if (stored) {
    await query("UPDATE idempotency_requests SET status_code = $3, response = $4 WHERE scope = $1 AND idempotency_key = $2",
      [scope, key, status, JSON.stringify(body)]);
  } else {
    await query("DELETE FROM idempotency_requests WHERE scope = $1 AND idempotency_key = $2", [scope, key]).catch(() => undefined);
  }
}

/**
 * Runs `work` once per key: a replay with the same fingerprint gets the stored answer, a different fingerprint 409
 * idempotency_conflict, a key still running 409 request_in_progress. Answers whose status `stores` accepts are kept
 * under the key; any other answer frees the key so the next request with it is judged afresh.
 */
export async function idempotent(
  res: ServerResponse,
  claim: { scope: string; key: string; fingerprint: string },
  stores: (status: number) => boolean,
  work: () => Promise<{ status: number; body: unknown }>,
): Promise<void> {
  const { scope, key } = claim;
  const held = await claimKey(scope, key, claim.fingerprint);
  if (held.kind === "replay") {
    sendJson(res, held.status, held.body);
    return;
  }
  let answer: { status: number; body: unknown };
  try {
    answer = await work();
  } catch (error) {
    if (error instanceof HttpError) await settle(scope, key, error.status, errorBody(error), stores(error.status));
    else await settle(scope, key, 0, null, false);
    throw error;
  }
  await settle(scope, key, answer.status, answer.body, stores(answer.status));
  sendJson(res, answer.status, answer.body);
}
