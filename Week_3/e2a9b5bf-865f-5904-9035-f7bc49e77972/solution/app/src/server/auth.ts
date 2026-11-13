import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import type { Account } from "../shared/types";
import { config, LIMITS } from "./config";
import { pool, newId, transaction } from "./db";
import { ApiError, conflict, Fields } from "./errors";
import type { Reply } from "./http";

export type Authed = Account;

const COOKIE = "lowlamp_session";
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  const [, salt, hash] = (stored ?? DUMMY_HASH).split("$");
  const key = await scryptAsync(password, Buffer.from(salt ?? "", "hex"), 32);
  const expected = Buffer.from(hash ?? "", "hex");
  return stored !== null && expected.length === key.length && timingSafeEqual(key, expected);
}

/** A hash for emails without an account, so unknown emails cost the same as known ones. */
const DUMMY_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(32)}`;

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

const EMAIL = /^[^\s@<>",;()[\]\\]+@[^\s@<>",;()[\]\\]+\.[^\s@<>",;()[\]\\]+$/;
const FORBIDDEN_IN_NAMES = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");

function validDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  const length = [...name].length;
  return length >= 1 && length <= 60 && !FORBIDDEN_IN_NAMES.test(name) ? name : null;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function cookieValue(req: IncomingMessage): string | null {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

export async function authenticate(req: IncomingMessage): Promise<Authed | null> {
  const token = cookieValue(req);
  if (!token) return null;
  const { rows } = await pool.query<Account>(
    `SELECT a.id, a.email, a.display_name FROM auth_sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

async function startSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO auth_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
    [hashToken(token), accountId, config.signinSessionSeconds],
  );
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.signinSessionSeconds}`;
}

export async function deleteExpiredSessions(): Promise<void> {
  await pool.query("DELETE FROM auth_sessions WHERE expires_at <= now()");
}

function objectBody(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export async function signup(body: unknown): Promise<Reply> {
  const input = objectBody(body);
  const email = typeof input.email === "string" ? normaliseEmail(input.email) : "";
  const emailOk = EMAIL.test(email);
  if (emailOk) {
    const { rows } = await pool.query("SELECT 1 FROM accounts WHERE email = $1", [email]);
    if (rows.length > 0) throw conflict("email_taken");
  }
  const fields = new Fields();
  if (!emailOk) fields.add("email");
  if (typeof input.password !== "string" || [...input.password].length < 10) fields.add("password");
  const displayName = validDisplayName(input.display_name);
  if (displayName === null) fields.add("display_name");
  fields.check();
  const id = newId();
  try {
    await pool.query("INSERT INTO accounts (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)", [
      id,
      email,
      await hashPassword(String(input.password)),
      displayName,
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw conflict("email_taken");
    throw error;
  }
  const cookie = await startSession(id);
  return { status: 201, body: { account: { id, email, display_name: displayName } }, headers: { "set-cookie": cookie } };
}

/** The sign-in lock: five failures inside the rolling window lock the email, known or not. */
export async function signin(body: unknown): Promise<Reply> {
  const input = objectBody(body);
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    throw new Fields().add("email").add("password").toError();
  }
  const email = normaliseEmail(input.email);
  const password = input.password;
  const outcome = await transaction(async (client) => {
    await client.query("INSERT INTO signin_state (email) VALUES ($1) ON CONFLICT DO NOTHING", [email]);
    const { rows } = await client.query<{ failures: Date[]; locked_until: Date | null; now: Date; remaining: number | null }>(
      `SELECT failures, locked_until, clock_timestamp() AS now,
              extract(epoch FROM (locked_until - clock_timestamp()))::float8 AS remaining
       FROM signin_state WHERE email = $1 FOR UPDATE`,
      [email],
    );
    const state = rows[0];
    if (!state) throw new Error("sign-in state missing");
    if (state.locked_until && (state.remaining ?? 0) > 0) {
      return { kind: "locked" as const, retry: Math.max(1, Math.ceil(state.remaining ?? 1)) };
    }
    const windowStart = state.now.getTime() - config.signinLockSeconds * 1000;
    const recent = (state.locked_until ? [] : state.failures).filter((t) => t.getTime() > windowStart);
    const account = (
      await client.query<{ id: string; email: string; display_name: string; password_hash: string }>(
        "SELECT id, email, display_name, password_hash FROM accounts WHERE email = $1",
        [email],
      )
    ).rows[0];
    if (await passwordMatches(password, account?.password_hash ?? null)) {
      await client.query("UPDATE signin_state SET failures = '{}', locked_until = NULL WHERE email = $1", [email]);
      return { kind: "ok" as const, account: account as NonNullable<typeof account> };
    }
    if (recent.length + 1 >= LIMITS.signinFailures) {
      await client.query(
        "UPDATE signin_state SET failures = '{}', locked_until = clock_timestamp() + make_interval(secs => $2) WHERE email = $1",
        [email, config.signinLockSeconds],
      );
    } else {
      await client.query("UPDATE signin_state SET failures = $2, locked_until = NULL WHERE email = $1", [
        email,
        [...recent, new Date()],
      ]);
    }
    return { kind: "failed" as const };
  });
  if (outcome.kind === "locked") {
    throw new ApiError(429, { error: "too_many_attempts" }, { "retry-after": String(outcome.retry) });
  }
  if (outcome.kind === "failed") throw new ApiError(401, { error: "bad_credentials" });
  const { id, email: stored, display_name } = outcome.account;
  return { status: 200, body: { account: { id, email: stored, display_name } }, headers: { "set-cookie": await startSession(id) } };
}

export async function signout(req: IncomingMessage): Promise<Reply> {
  const token = cookieValue(req);
  if (token) await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(token)]);
  return { status: 204, headers: { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
}
