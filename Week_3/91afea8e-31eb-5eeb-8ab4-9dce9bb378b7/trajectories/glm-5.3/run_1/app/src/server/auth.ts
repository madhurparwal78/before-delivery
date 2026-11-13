import type { IncomingMessage } from "node:http";
import { query, one, withTransaction } from "./db.js";
import { config } from "./config.js";
import { id, code6, sha256, verifyPassword } from "./crypto.js";
import { copy, ApiError, signedOut } from "./errors.js";
import { sendSms } from "./providers.js";
import { futureIso } from "./time.js";

export interface AccountRow {
  account_id: string; name: string; email: string; phone: string;
  password_hash: string; balance_paise: string; role: string;
}

export const COOKIE_PENDING = "chauraha_pending";
export const COOKIE_SESSION = "chauraha_session";
export const COOKIE_ACCESS = "chauraha_access";

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function cookieString(name: string, value: string, maxAgeSeconds: number, clear = false): string {
  const attrs = [
    `${name}=${clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    clear ? "Max-Age=0" : `Max-Age=${maxAgeSeconds}`,
  ];
  return attrs.join("; ");
}

export function setPendingCookie(value: string): string {
  return cookieString(COOKIE_PENDING, value, 600);
}

export function clearPendingCookie(): string {
  return cookieString(COOKIE_PENDING, "", 0, true);
}

export function setSessionCookies(sessionId: string): string[] {
  return [
    cookieString(COOKIE_SESSION, sessionId, config.timing.sessionTtlSeconds),
    cookieString(COOKIE_ACCESS, sessionId, config.timing.accessTtlSeconds),
  ];
}

export function refreshAccessCookie(sessionId: string): string {
  return cookieString(COOKIE_ACCESS, sessionId, config.timing.accessTtlSeconds);
}

export function clearSessionCookies(): string[] {
  return [
    cookieString(COOKIE_SESSION, "", 0, true),
    cookieString(COOKIE_ACCESS, "", 0, true),
  ];
}

/** Both shoppers and sellers sign in; the identifier may be either table's email or phone. */
export async function accountByIdOrIdentifier(identifier: string): Promise<AccountRow | null> {
  const norm = normalizeIdentifier(identifier);
  const rows = await query<AccountRow>(
    `SELECT account_id, name, email, phone, password_hash, balance_paise::text AS balance_paise, role FROM shoppers
     WHERE email = $1 OR phone = $2
     UNION ALL
     SELECT seller_id AS account_id, name, email, phone, password_hash, '0' AS balance_paise, 'seller' AS role
     FROM sellers WHERE email = $1 OR phone = $2`,
    [norm.email ?? norm.identifier, norm.phone ?? norm.identifier],
  );
  return rows[0] ?? null;
}

export function normalizeIdentifier(raw: string): { identifier: string; email: string | null; phone: string | null } {
  const trimmed = raw.trim();
  if (trimmed.includes("@")) return { identifier: trimmed.toLowerCase(), email: trimmed.toLowerCase(), phone: null };
  const digits = trimmed.replace(/[^\d]/g, "");
  const phone = digits.length === 10 ? `+91${digits}` : digits.length === 12 && digits.startsWith("91") ? `+${digits}` : `+91${digits}`;
  return { identifier: phone, email: null, phone };
}

export interface RateCheck { allowed: boolean; retryAfter: number }

/** Send counter: at most 3 accepted sends per identifier per code window. */
export async function countSends(identifier: string): Promise<number> {
  const rows = await query<{ n: string }>(
    "SELECT count(*) AS n FROM code_sends WHERE identifier = $1 AND sent_at > now() - ($2 || ' seconds')::interval",
    [identifier, String(config.timing.codeWindowSeconds)],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function recordSend(identifier: string, purpose: string): Promise<void> {
  await query("INSERT INTO code_sends (identifier, purpose) VALUES ($1,$2)", [identifier, purpose]);
}

export async function oldestSendAge(identifier: string): Promise<number> {
  const rows = await query<{ age: string }>(
    "SELECT extract(epoch from now() - min(sent_at)) AS age FROM code_sends WHERE identifier = $1 AND sent_at > now() - ($2 || ' seconds')::interval",
    [identifier, String(config.timing.codeWindowSeconds)],
  );
  const age = Number(rows[0]?.age ?? 0);
  return Math.max(1, Math.ceil(config.timing.codeWindowSeconds - age));
}

export async function rateLimit(bucketKey: string, limit: number): Promise<RateCheck> {
  return withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO rate_counters (bucket, window_start, count) VALUES ($1, now(), 1)
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN rate_counters.window_start < now() - ($2 || ' seconds')::interval THEN 1 ELSE rate_counters.count + 1 END,
         window_start = CASE WHEN rate_counters.window_start < now() - ($2 || ' seconds')::interval THEN now() ELSE rate_counters.window_start END
       RETURNING count, window_start`,
      [bucketKey, String(config.timing.rateWindowSeconds)],
    );
    const count = res.rows[0].count as number;
    const windowStart = new Date(res.rows[0].window_start as string).getTime();
    const elapsed = (Date.now() - windowStart) / 1000;
    const retryAfter = Math.max(1, Math.ceil(config.timing.rateWindowSeconds - elapsed));
    return { allowed: count <= limit, retryAfter };
  });
}

/** Step one: correct password creates a pending sign-in reachable only by the code step. */
export async function beginSignin(identifier: string, password: string): Promise<{ pendingId: string; resendIn: number }> {
  const account = await accountByIdOrIdentifier(identifier);
  if (!account || !verifyPassword(password, account.password_hash)) {
    throw new ApiError(401, "invalid_credentials", copy.invalidCredentials);
  }
  const sends = await countSends(identifier);
  if (sends >= 3) {
    throw new ApiError(429, "too_many_codes", copy.tooManyCodes, { retryAfter: await oldestSendAge(identifier) });
  }
  const code = code6();
  const sms = await sendSms(account.phone, "signin_code", code);
  if (!sms.ok) throw new ApiError(503, "sms_unavailable", copy.smsUnavailable);
  await recordSend(identifier, "signin");
  const pendingId = id("PD");
  await withTransaction(async (client) => {
    await client.query("DELETE FROM pending_signins WHERE account_id = $1", [account.account_id]);
    await client.query(
      `INSERT INTO pending_signins (pending_id, account_id, role, identifier, code_hash, tries, issued_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,0,now(),now() + ($6 || ' seconds')::interval)`,
      [pendingId, account.account_id, account.role, identifier, sha256(code), String(config.timing.otpTtlSeconds)],
    );
  });
  return { pendingId, resendIn: config.timing.codeResendSeconds };
}

export async function resendPendingCode(pending: { pending_id: string; account_id: string; identifier: string; issued_at: string }): Promise<{ resendIn: number }> {
  const age = (Date.now() - new Date(pending.issued_at).getTime()) / 1000;
  if (age < config.timing.codeResendSeconds) {
    throw new ApiError(429, "resend_too_soon", copy.resendTooSoon, { retryAfter: Math.ceil(config.timing.codeResendSeconds - age) });
  }
  const sends = await countSends(pending.identifier);
  if (sends >= 3) {
    throw new ApiError(429, "too_many_codes", copy.tooManyCodes, { retryAfter: await oldestSendAge(pending.identifier) });
  }
  const account = await one<AccountRow>("SELECT * FROM shoppers WHERE account_id = $1", [pending.account_id]);
  if (!account) throw signedOut();
  const code = code6();
  const sms = await sendSms(account.phone, "signin_code", code);
  if (!sms.ok) throw new ApiError(503, "sms_unavailable", copy.smsUnavailable);
  await recordSend(pending.identifier, "resend");
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE pending_signins SET code_hash = $2, tries = 0, issued_at = now(), expires_at = now() + ($3 || ' seconds')::interval WHERE pending_id = $1`,
      [pending.pending_id, sha256(code), String(config.timing.otpTtlSeconds)],
    );
  });
  return { resendIn: config.timing.codeResendSeconds };
}

/** Step two: the code passes, the pending record goes, two new cookies with fresh values appear. */
export async function finishPending(pending: { pending_id: string; account_id: string; code_hash: string; tries: number; issued_at: string; expires_at: string; identifier: string }, code: string): Promise<{ sessionId: string; account: AccountRow }> {
  const expired = Date.now() >= new Date(pending.expires_at).getTime();
  if (expired || pending.tries >= 5) {
    await query("DELETE FROM pending_signins WHERE pending_id = $1", [pending.pending_id]);
    throw new ApiError(401, "invalid_code", copy.invalidCode);
  }
  if (sha256(code) !== pending.code_hash) {
    await query("UPDATE pending_signins SET tries = tries + 1 WHERE pending_id = $1", [pending.pending_id]);
    throw new ApiError(401, "invalid_code", copy.invalidCode);
  }
  const account = await accountById(pending.account_id);
  if (!account) throw signedOut();
  const sessionId = id("SES");
  await withTransaction(async (client) => {
    await client.query("DELETE FROM pending_signins WHERE pending_id = $1", [pending.pending_id]);
    await client.query(
      `INSERT INTO sessions (session_id, account_id, role, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' seconds')::interval)`,
      [sessionId, account.account_id, account.role, String(config.timing.sessionTtlSeconds)],
    );
  });
  return { sessionId, account };
}

/** Shoppers and sellers both hold sessions; sellers are keyed by their seller id. */
export async function accountById(accountId: string): Promise<AccountRow | null> {
  const rows = await query<AccountRow>(
    `SELECT account_id, name, email, phone, password_hash, balance_paise::text AS balance_paise, role FROM shoppers WHERE account_id = $1
     UNION ALL
     SELECT seller_id AS account_id, name, email, phone, password_hash, '0' AS balance_paise, 'seller' AS role FROM sellers WHERE seller_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

export async function loadSession(cookies: Record<string, string>): Promise<{ sessionId: string; account: AccountRow } | null> {
  const access = cookies[COOKIE_ACCESS];
  const refresh = cookies[COOKIE_SESSION];
  const token = access || refresh;
  if (!token) return null;
  const row = await one<{ session_id: string; account_id: string; role: string }>(
    "SELECT session_id, account_id, role FROM sessions WHERE session_id = $1 AND expires_at > now()",
    [token],
  );
  if (!row) return null;
  if (row.role === "seller") {
    const seller = await one<{ seller_id: string; name: string; email: string; phone: string; password_hash: string }>(
      "SELECT seller_id, name, email, phone, password_hash FROM sellers WHERE seller_id = $1", [row.account_id]);
    if (!seller) return null;
    return { sessionId: token, account: { account_id: seller.seller_id, name: seller.name, email: seller.email, phone: seller.phone, password_hash: seller.password_hash, balance_paise: "0", role: "seller" } };
  }
  const account = await one<AccountRow>("SELECT * FROM shoppers WHERE account_id = $1", [row.account_id]);
  if (!account) return null;
  return { sessionId: token, account };
}

export async function loadPending(cookies: Record<string, string>): Promise<{ pending_id: string; account_id: string; code_hash: string; tries: number; issued_at: string; expires_at: string; identifier: string } | null> {
  const pendingId = cookies[COOKIE_PENDING];
  if (!pendingId) return null;
  return one("SELECT * FROM pending_signins WHERE pending_id = $1 AND expires_at > now()", [pendingId]);
}

/** Password change ends every other session; the current one keeps a new id. */
export async function changePassword(accountId: string, current: string, next: string, currentSessionId: string): Promise<string> {
  const account = await one<AccountRow>("SELECT * FROM shoppers WHERE account_id = $1", [accountId]);
  if (!account || !verifyPassword(current, account.password_hash)) return "";
  const { hashPassword } = await import("./crypto.js");
  const newSession = id("SES");
  await withTransaction(async (client) => {
    await client.query("UPDATE shoppers SET password_hash = $2 WHERE account_id = $1", [accountId, hashPassword(next)]);
    // every other session ends; the caller gets a fresh one so it stays signed in
    await client.query("DELETE FROM sessions WHERE account_id = $1", [accountId]);
    await client.query(
      `INSERT INTO sessions (session_id, account_id, role, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' seconds')::interval)`,
      [newSession, accountId, account.role, String(config.timing.sessionTtlSeconds)],
    );
  });
  void currentSessionId;
  return newSession;
}
