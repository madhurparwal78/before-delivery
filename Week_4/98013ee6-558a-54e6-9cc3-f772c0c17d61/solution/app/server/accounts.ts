import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "./config.js";
import { now } from "./clock.js";
import { exactlyOne, isUniqueViolation, one, pool, tx, type Db } from "./db.js";
import { conflict, invalidCredentials, validation } from "./errors.js";
import { Body, parseCookies, type SessionUser } from "./http.js";
import { sendMailInBackground } from "./mail.js";
import { codePoints } from "../shared/text.js";
import { isEmail, normalizeEmail } from "./text.js";

const KEY_BYTES = 32;
const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, (error, key) => (error ? reject(error) : resolve(key)));
  });
const SESSION_COOKIE = "ml_session";
const SESSION_SECONDS = 30 * 24 * 3600;
const HANDLE = /^[a-z0-9_]{3,20}$/;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}

/** Always derives a key, even for an unknown email, so both failures take the same time. */
async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  const [, salt = "", hash = ""] = (stored ?? UNKNOWN_ACCOUNT).split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = await derive(password, Buffer.from(salt, "hex"));
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

const UNKNOWN_ACCOUNT = "scrypt:00:00";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

interface AccountFields {
  email: string;
  password: string;
  name: string;
  handle: string;
}

/** The sign-up field rules, shared by the API and the grading seed. Returns normalised values. */
export function validateAccount(input: { email: unknown; password: unknown; name: unknown; handle: unknown }): AccountFields {
  const email = typeof input.email === "string" ? normalizeEmail(input.email) : "";
  if (!isEmail(email)) throw validation("email");
  if (typeof input.password !== "string" || codePoints(input.password) < 8) throw validation("password");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name === "" || codePoints(name) > 50) throw validation("name");
  if (typeof input.handle !== "string" || !HANDLE.test(input.handle)) throw validation("handle");
  return { email, password: input.password, name, handle: input.handle };
}

async function handleTaken(handle: unknown): Promise<boolean> {
  return typeof handle === "string" && (await one(pool, "SELECT 1 FROM users WHERE handle = $1", [handle])) !== null;
}

async function insertUser(db: Db, user: { email: string; passwordHash: string; name: string; handle: string }, at: Date): Promise<number> {
  const created = await exactlyOne<{ id: number }>(
    db,
    "INSERT INTO users (email, password_hash, name, handle, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [user.email, user.passwordHash, user.name, user.handle, at],
  );
  return created.id;
}

export async function createUser(db: Db, fields: AccountFields, at: Date): Promise<number> {
  return insertUser(db, { ...fields, passwordHash: await hashPassword(fields.password) }, at);
}

export async function requestSignUp(body: Body): Promise<void> {
  if (await handleTaken(body.get("handle"))) throw conflict("handle_taken");
  const fields = validateAccount({ email: body.get("email"), password: body.get("password"), name: body.get("name"), handle: body.get("handle") });
  const passwordHash = await hashPassword(fields.password);
  const existing = await one(pool, "SELECT 1 FROM users WHERE lower(email) = $1", [fields.email]);
  if (existing) {
    sendMailInBackground(
      fields.email,
      "You already have a Mothlight account",
      `You already have a Mothlight account for this address.\n\nSign in: ${config.publicUrl}/signin\n`,
    );
    return;
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(
    `INSERT INTO signups (email, password_hash, name, handle, code_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET password_hash = $2, name = $3, handle = $4, code_hash = $5, created_at = $6`,
    [fields.email, passwordHash, fields.name, fields.handle, sha256(code), now()],
  );
  sendMailInBackground(fields.email, `Your Mothlight code is ${code}`, `Your Mothlight code is ${code}\n\nEnter it to finish creating your account.\n`);
}

interface Authenticated {
  user: Omit<SessionUser, "email">;
  cookie: string;
}

async function openSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)", [sha256(token), userId, now()]);
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export async function confirmSignUp(body: Body): Promise<Authenticated> {
  const email = typeof body.get("email") === "string" ? normalizeEmail(body.string("email")) : "";
  const code = body.get("code");
  const pending = await one<{ password_hash: string; name: string; handle: string; code_hash: string }>(
    pool, "SELECT password_hash, name, handle, code_hash FROM signups WHERE email = $1", [email],
  );
  if (!pending || typeof code !== "string" || sha256(code.trim()) !== pending.code_hash) throw validation("code");
  const userId = await tx(async (client) => {
    const removed = await client.query("DELETE FROM signups WHERE email = $1 AND code_hash = $2", [email, pending.code_hash]);
    if (removed.rowCount === 0) throw validation("code");
    try {
      return await insertUser(client, { email, passwordHash: pending.password_hash, name: pending.name, handle: pending.handle }, now());
    } catch (error) {
      throw isUniqueViolation(error) ? conflict("handle_taken") : error;
    }
  });
  return { user: { id: userId, name: pending.name, handle: pending.handle }, cookie: await openSession(userId) };
}

export async function signIn(body: Body): Promise<Authenticated & { email: string }> {
  const email = typeof body.get("email") === "string" ? normalizeEmail(body.string("email")) : "";
  const password = typeof body.get("password") === "string" ? body.string("password") : "";
  const user = await one<{ id: number; name: string; handle: string; password_hash: string }>(
    pool, "SELECT id, name, handle, password_hash FROM users WHERE lower(email) = $1", [email],
  );
  const matched = await passwordMatches(password, user?.password_hash ?? null);
  if (!user || !matched) throw invalidCredentials();
  return { user: { id: user.id, name: user.name, handle: user.handle }, email, cookie: await openSession(user.id) };
}

export async function endSession(req: IncomingMessage): Promise<void> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

export async function userForRequest(req: IncomingMessage): Promise<SessionUser | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  return one<SessionUser>(
    pool,
    "SELECT u.id, u.name, u.handle, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [sha256(token)],
  );
}
