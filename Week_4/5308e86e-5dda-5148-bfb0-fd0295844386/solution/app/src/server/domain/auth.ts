/** Passwords, sessions, sign-up, sign-in and the lockout. */
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { EMAIL_MAX, LOCKOUT_COUNT, PASSWORD_MAX, PASSWORD_MIN, DISPLAY_NAME_MAX } from "../../shared/rules.js";
import { config } from "../config.js";
import { businessNow } from "../clock.js";
import { isUniqueViolation, query, transaction, type Tx } from "../db.js";
import { Fields, refusal } from "../http/errors.js";
import { codePointLength, hasRefusedCharacter, isEmailAddress } from "../http/text.js";
import { newId } from "../ids.js";
import type { Role, SessionUser } from "../http/context.js";
import { createAuditHead } from "./audit.js";
import { createAccount } from "./accounts.js";

const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK = 8;
const SCRYPT_PARALLEL = 1;
const SCRYPT_MEMORY = 128 * 1024 * 1024;
const KEY_BYTES = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: SCRYPT_COST, r: SCRYPT_BLOCK, p: SCRYPT_PARALLEL, maxmem: SCRYPT_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key ?? "", "base64");
  const actual = await derive(password, Buffer.from(salt ?? "", "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Unknown emails are checked against this hash so they cost the same work as a wrong password. */
const unknownEmailHash = hashPassword(randomBytes(12).toString("hex"));

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function findCompanyName(companyId: string): Promise<string> {
  const found = await query<{ name: string }>("SELECT name FROM companies WHERE id = $1", [companyId]);
  return found.rows[0]?.name ?? "";
}

export function userView(user: SessionUser) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, company_id: user.companyId };
}

/** The session's user, or null for a missing, invalid or signed-out token. */
export async function authenticate(token: string): Promise<SessionUser | null> {
  const found = await query(
    `SELECT u.id, u.email, u.name, m.role, m.company_id, s.token_hash
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN memberships m ON m.user_id = u.id
     WHERE s.token_hash = $1`,
    [digestToken(token)],
  );
  const row = found.rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role as Role, companyId: row.company_id, sessionId: row.token_hash };
}

async function startSession(tx: Tx, userId: string, now: Date): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await tx.query("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)", [digestToken(token), userId, now]);
  return token;
}

export async function endSession(sessionId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE token_hash = $1", [sessionId]);
}

interface SignUpInput {
  email: string;
  name: string;
  password: string;
}

export async function signUp(input: SignUpInput): Promise<{ token: string; user: SessionUser }> {
  const now = businessNow();
  const passwordHash = await hashPassword(input.password);
  try {
    return await transaction(async (tx) => {
      const userId = newId();
      const companyId = newId();
      await tx.query("INSERT INTO companies (id, name, created_at) VALUES ($1, $2, $3)", [companyId, input.name, now]);
      await tx.query("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)", [userId, input.email, input.name, passwordHash, now]);
      await tx.query("INSERT INTO memberships (user_id, company_id, role) VALUES ($1, $2, 'owner')", [userId, companyId]);
      await createAuditHead(tx, companyId);
      await createAccount(tx, companyId, "Checking", "checking", now);
      const token = await startSession(tx, userId, now);
      return { token, user: { id: userId, email: input.email, name: input.name, role: "owner" as Role, companyId, sessionId: digestToken(token) } };
    });
  } catch (error) {
    if (isUniqueViolation(error, "users_email")) throw refusal(409, "email_taken");
    throw error;
  }
}

export async function logIn(email: string, password: string): Promise<{ token: string; user: SessionUser }> {
  const found = await query(
    `SELECT u.id, u.email, u.name, u.password_hash, m.role, m.company_id
     FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = $1`,
    [email],
  );
  const account = found.rows[0];
  const correct = await checkPassword(password, account ? account.password_hash : await unknownEmailHash);
  const now = businessNow();
  const windowStart = new Date(now.getTime() - config.lockoutWindowSeconds * 1000);
  const outcome = await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`login:${email}`]);
    const failures = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM login_failures WHERE email = $1 AND failed_at > $2", [email, windowStart]);
    if ((failures.rows[0]?.n ?? 0) >= LOCKOUT_COUNT) return { kind: "locked" as const };
    if (!account || !correct) {
      await tx.query("INSERT INTO login_failures (email, failed_at) VALUES ($1, $2)", [email, now]);
      return { kind: "invalid" as const };
    }
    await tx.query("DELETE FROM login_failures WHERE email = $1", [email]);
    const token = await startSession(tx, account.id, now);
    return {
      kind: "signed-in" as const,
      token,
      user: { id: account.id, email: account.email, name: account.name, role: account.role as Role, companyId: account.company_id, sessionId: digestToken(token) },
    };
  });
  if (outcome.kind === "locked") throw refusal(429, "too_many_attempts");
  if (outcome.kind === "invalid") throw refusal(401, "invalid_credentials");
  return { token: outcome.token, user: outcome.user };
}

/** Checks and normalises the sign-up body. */
export function readSignUp(body: Record<string, unknown>): SignUpInput {
  const fields = new Fields();
  const rawEmail = body.email;
  const rawName = body.name;
  const rawPassword = body.password;
  let email = "";
  let name = "";
  let password = "";
  if (typeof rawEmail !== "string") fields.fail("email", "Enter a valid email");
  else {
    email = normalizeEmail(rawEmail);
    if (hasRefusedCharacter(email, "single-line") || !isEmailAddress(email, EMAIL_MAX)) fields.fail("email", "Enter a valid email");
  }
  if (typeof rawName !== "string") fields.fail("name", "Enter your name");
  else {
    name = rawName.trim();
    const length = codePointLength(name);
    if (length < 1 || length > DISPLAY_NAME_MAX || hasRefusedCharacter(name, "single-line")) fields.fail("name", "Enter your name");
  }
  if (typeof rawPassword !== "string") fields.fail("password", "Password must be at least 8 characters");
  else {
    password = rawPassword;
    const length = codePointLength(password);
    if (length < PASSWORD_MIN || length > PASSWORD_MAX || hasRefusedCharacter(password, "plain")) fields.fail("password", "Password must be at least 8 characters");
  }
  fields.raise();
  return { email, name, password };
}

export function readLogIn(body: Record<string, unknown>): { email: string; password: string } {
  const fields = new Fields();
  if (typeof body.email !== "string" || hasRefusedCharacter(body.email, "single-line")) fields.fail("email", "Enter a valid email");
  if (typeof body.password !== "string" || hasRefusedCharacter(body.password, "plain")) fields.fail("password", "Enter your password");
  fields.raise();
  return { email: normalizeEmail(body.email as string), password: body.password as string };
}
