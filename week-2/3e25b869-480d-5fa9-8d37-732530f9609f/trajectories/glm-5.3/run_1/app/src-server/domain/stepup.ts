// Step-up codes: request with rate limit and identical answers for known and
// unknown emails, verification with lock-out, and the session that follows.
import { type Pool } from "pg";
import { ApiError } from "../core/http.js";
import { message } from "../core/copy.js";
import type { Env } from "../core/env.js";
import type { Locale } from "../core/catalog.js";
import { isValidEmail, normalizeEmail, hasControlChars } from "./text.js";
import { fieldMessage } from "../core/copy.js";
import { stepupCodeEmail } from "../core/emails.js";
import { queueNotice } from "../services/outbox.js";
import { torontoLocalMinute } from "../core/toronto.js";

export async function requestCode(
  pool: Pool,
  env: Env,
  outbox: { kick(): void },
  locale: Locale,
  email: string,
  purpose: string
): Promise<{ lockedOut: boolean }> {
  const normalized = normalizeEmail(email);
  const fields: Record<string, string> = {};
  if (!isValidEmail(normalized)) {
    fields.email = fieldMessage("email", locale);
  }
  if (purpose !== "checkout" && purpose !== "sign_in") {
    fields.purpose = fieldMessage("purpose", locale);
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const now = new Date();
  const lock = await pool.query("SELECT until FROM stepup_locks WHERE email = $1", [normalized]);
  const lockedOut = lock.rows.length > 0 && (lock.rows[0].until as Date) > now;

  const windowStart = new Date(now.getTime() - env.stepupRateWindowSeconds * 1000);
  const counted = await pool.query(
    `SELECT at FROM stepup_requests
     WHERE email = $1 AND at > $2
     ORDER BY at ASC`,
    [normalized, windowStart]
  );
  if (counted.rows.length >= env.stepupRateLimit) {
    const oldest = counted.rows[0].at as Date;
    const retryAfter = Math.max(
      1,
      Math.ceil((oldest.getTime() + env.stepupRateWindowSeconds * 1000 - now.getTime()) / 1000)
    );
    throw new ApiError(429, "rate_limited", message("rate_limited", locale), null, {
      "Retry-After": String(retryAfter)
    });
  }
  await pool.query("INSERT INTO stepup_requests (email, at) VALUES ($1, now())", [normalized]);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const counter = await pool.query("UPDATE counters SET value = value + 1 WHERE name = 'sc' RETURNING value");
  const scNumber = `SC-${String(counter.rows[0].value).padStart(6, "0")}`;
  const expiresAt = new Date(now.getTime() + env.stepupCodeTtlSeconds * 1000);
  await pool.query(
    "INSERT INTO stepup_codes (sc_number, email, code, expires_at) VALUES ($1, $2, $3, $4)",
    [scNumber, normalized, code, expiresAt]
  );
  const content = stepupCodeEmail(code, torontoLocalMinute(expiresAt));
  if (!lockedOut) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await queueNotice(client, {
        key: `code.${scNumber}`,
        kind: "stepup_code",
        to: normalized,
        locale,
        subjectEn: content.subjectEn,
        subjectFr: content.subjectFr,
        linesEn: content.linesEn,
        linesFr: content.linesFr
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      client.release();
      throw err;
    }
    client.release();
    outbox.kick();
  }
  return { lockedOut };
}

export interface VerifyResult {
  customerId: number;
}

export async function verifyCode(
  pool: Pool,
  env: Env,
  locale: Locale,
  email: string,
  code: string
): Promise<VerifyResult> {
  const normalized = normalizeEmail(email);
  const fields: Record<string, string> = {};
  if (!isValidEmail(normalized)) {
    fields.email = fieldMessage("email", locale);
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code) || hasControlChars(code)) {
    fields.code = fieldMessage("code", locale);
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const now = new Date();
  const lock = await pool.query("SELECT until FROM stepup_locks WHERE email = $1", [normalized]);
  if (lock.rows.length > 0 && (lock.rows[0].until as Date) > now) {
    throw new ApiError(429, "stepup_locked", message("stepup_locked", locale));
  }
  const res = await pool.query(
    `SELECT id, email FROM stepup_codes
     WHERE email = $1 AND code = $2 AND expires_at > $3 AND used_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [normalized, code, now]
  );
  if (res.rows.length === 0) {
    await recordFailedAttempt(pool, env, normalized, now);
    throw new ApiError(422, "invalid", null, { code: fieldMessage("code", locale) });
  }
  // Using any code ends all of that email's codes.
  await pool.query("UPDATE stepup_codes SET used_at = now() WHERE email = $1", [normalized]);
  await pool.query("DELETE FROM stepup_locks WHERE email = $1", [normalized]);
  await pool.query("DELETE FROM stepup_attempts WHERE email = $1", [normalized]);
  const customerId = await ensureCustomer(pool, normalized, locale);
  return { customerId };
}

async function recordFailedAttempt(pool: Pool, env: Env, email: string, now: Date): Promise<void> {
  await pool.query("INSERT INTO stepup_attempts (email, at) VALUES ($1, $2)", [email, now]);
  const count = await pool.query("SELECT count(*)::int AS n FROM stepup_attempts WHERE email = $1", [email]);
  if (count.rows[0].n >= 5) {
    await pool.query(
      `INSERT INTO stepup_locks (email, until) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET until = $2`,
      [email, new Date(now.getTime() + env.stepupLockSeconds * 1000)]
    );
    await pool.query("DELETE FROM stepup_attempts WHERE email = $1", [email]);
  }
}

export async function ensureCustomer(pool: Pool, email: string, locale: Locale): Promise<number> {
  const res = await pool.query(
    `INSERT INTO customers (email, locale) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET locale = EXCLUDED.locale
     RETURNING id`,
    [email, locale]
  );
  return res.rows[0].id as number;
}

export async function customerLocale(pool: Pool, customerId: number): Promise<Locale> {
  const res = await pool.query("SELECT locale FROM customers WHERE id = $1", [customerId]);
  return (res.rows[0]?.locale as Locale) ?? "en-CA";
}
