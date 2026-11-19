// Idempotency-Key handling for session starts and plan changes, scoped to the calling member.
// The first request claims the key; a repeat of the same request gets the stored status and body,
// a different request under the same key gets 409 idempotency_conflict, and a repeat while the first
// still runs gets 409 idempotency_in_progress.
import { createHash } from "node:crypto";
import type { Caller } from "./access";
import { ApiError, errorBody, invalid, type Request } from "./http";
import { one, pool } from "./db";
import { limited } from "../shared/text";

interface Outcome {
  status: number;
  body: unknown;
}

export async function idempotent(caller: Caller, request: Request, fingerprint: unknown, run: () => Promise<Outcome>): Promise<Outcome> {
  const header = request.req.headers["idempotency-key"];
  if (header === undefined) return run().catch(asOutcome);
  const key = limited(Array.isArray(header) ? header[0] : header, 1, 100);
  if (key === null) throw invalid({ idempotency_key: "Use an idempotency key of 1 to 100 characters." });
  const hash = createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
  for (;;) {
    const claimed = await one("INSERT INTO idempotency_records (member_id, key, request_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key", [caller.id, key, hash]);
    if (claimed) break;
    const stored = await replay(caller.id, key, hash);
    if (stored) return stored;
  }
  let outcome: Outcome;
  try {
    outcome = await run().catch(asOutcome);
  } catch (error) {
    await pool.query("DELETE FROM idempotency_records WHERE member_id = $1 AND key = $2", [caller.id, key]);
    throw error;
  }
  // Only a 2xx, a 409 state conflict or a 429 is kept; anything else (a 422, a 503) leaves the key free for a fresh try.
  const kept = (outcome.status >= 200 && outcome.status < 300) || outcome.status === 409 || outcome.status === 429;
  if (!kept) await pool.query("DELETE FROM idempotency_records WHERE member_id = $1 AND key = $2", [caller.id, key]);
  else await pool.query("UPDATE idempotency_records SET status = $3, body = $4 WHERE member_id = $1 AND key = $2", [caller.id, key, outcome.status, JSON.stringify(outcome.body)]);
  return outcome;
}

function asOutcome(error: unknown): Outcome {
  if (!(error instanceof ApiError)) throw error;
  return { status: error.status, body: errorBody(error) };
}

/**
 * The stored response for a repeat of the same request; null when the first request released the key
 * meanwhile, so this one may run instead.
 */
async function replay(memberId: string, key: string, hash: string): Promise<Outcome | null> {
  // The body is kept as the exact JSON text sent; parsing it back keeps its key order, so the replay is byte for byte.
  const record = await one<{ request_hash: string; status: number | null; body: string | null }>(
    "SELECT request_hash, status, body FROM idempotency_records WHERE member_id = $1 AND key = $2",
    [memberId, key],
  );
  if (!record) return null;
  if (record.request_hash !== hash) throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used for a different request.");
  if (record.status === null) throw new ApiError(409, "idempotency_in_progress", "The first request with this Idempotency-Key is still running.");
  return { status: record.status, body: JSON.parse(record.body!) };
}
