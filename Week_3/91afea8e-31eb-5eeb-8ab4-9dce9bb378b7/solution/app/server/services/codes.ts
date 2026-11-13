import { randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { one, query, transaction } from "../db.js";
import { ApiError } from "../errors.js";

const SENDS_PER_WINDOW = 3;
const TRIES_PER_CODE = 5;

export type CodePurpose = "signup" | "signin" | "reset";

/** Counts one accepted send request for an identifier; the fourth in a window answers 429 whether or not the account exists. */
export async function countSend(identifier: string, nowMs: number): Promise<void> {
  const windowMs = config.seconds.codeWindow * 1000;
  const retryAfter = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`send:${identifier}`]);
    await client.query("DELETE FROM code_sends WHERE identifier = $1 AND at <= $2", [identifier, nowMs - windowMs]);
    const counted = await client.query("SELECT count(*)::int AS sends, min(at) AS oldest FROM code_sends WHERE identifier = $1", [identifier]);
    const row = counted.rows[0] as { sends: number; oldest: number | null };
    if (row.sends >= SENDS_PER_WINDOW && row.oldest !== null) return Math.max(1, Math.ceil((row.oldest + windowMs - nowMs) / 1000));
    await client.query("INSERT INTO code_sends (identifier, at) VALUES ($1, $2)", [identifier, nowMs]);
    return 0;
  });
  if (retryAfter > 0) throw new ApiError(429, "too_many_codes", {}, { retry_after: retryAfter });
}

/** Seconds a resend must still wait, or 0 when one may be sent now. */
export async function resendWait(identifier: string, nowMs: number): Promise<number> {
  const last = await one<{ at: number }>("SELECT max(at) AS at FROM code_sends WHERE identifier = $1", [identifier]);
  if (!last || last.at === null) return 0;
  return Math.max(0, Math.ceil((last.at + config.seconds.codeResend * 1000 - nowMs) / 1000));
}

export async function issueCode(ownerId: string, purpose: CodePurpose, nowMs: number): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await query(
    `INSERT INTO auth_codes (owner_id, purpose, code, issued_at, tries) VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (owner_id, purpose) DO UPDATE SET code = EXCLUDED.code, issued_at = EXCLUDED.issued_at, tries = 0`,
    [ownerId, purpose, code, nowMs],
  );
  return code;
}

/** A code passes before its expiry and within 5 tries; a passing code is consumed. */
export async function checkCode(ownerId: string, purpose: CodePurpose, submitted: string, nowMs: number): Promise<boolean> {
  return transaction(async (client) => {
    const found = await client.query("SELECT code, issued_at, tries FROM auth_codes WHERE owner_id = $1 AND purpose = $2 FOR UPDATE", [ownerId, purpose]);
    const row = found.rows[0] as { code: string; issued_at: number; tries: number } | undefined;
    if (!row || row.tries >= TRIES_PER_CODE) return false;
    await client.query("UPDATE auth_codes SET tries = tries + 1 WHERE owner_id = $1 AND purpose = $2", [ownerId, purpose]);
    const fresh = nowMs < row.issued_at + config.seconds.otpTtl * 1000;
    const expected = Buffer.from(row.code);
    const given = Buffer.from(submitted.padEnd(expected.length, " ").slice(0, expected.length));
    const matches = timingSafeEqual(expected, given) && submitted.length === row.code.length;
    if (!fresh || !matches) return false;
    await client.query("DELETE FROM auth_codes WHERE owner_id = $1 AND purpose = $2", [ownerId, purpose]);
    return true;
  });
}
