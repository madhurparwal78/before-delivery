import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import { ApiError } from "../shared/errors.js";
import { EMAIL, fieldError } from "../shared/notices.js";
import { newId, one, pool, type Db } from "./db.js";
import { cookies } from "./http.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface User {
  id: string;
  name: string;
  email: string;
}

const SESSION_COOKIE = "pl_session";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key, "base64url");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [tokenHash(token), userId]);
  return token;
}

export async function endSession(req: IncomingMessage): Promise<void> {
  const token = cookies(req)[SESSION_COOKIE];
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export async function currentUser(req: IncomingMessage): Promise<User | null> {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = await one<User>(pool, "SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1", [tokenHash(token)]);
  return row ?? null;
}

export function requireUser(user: User | null): User {
  if (!user) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  return user;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Validate sign-up input; field messages are the brief's exact copy. */
function signupProblems(body: Record<string, unknown>): Record<string, string> {
  const problems: Record<string, string> = {};
  const name = text(body.name).trim();
  if (!name || name.length > 80) problems.name = fieldError.nameEmpty;
  if (!EMAIL.test(text(body.email).trim())) problems.email = fieldError.emailInvalid;
  if (text(body.password).length < 10) problems.password = fieldError.passwordShort;
  return problems;
}

/** Create an account; throws 422 with field problems or 409 when the email is taken. */
export async function createUser(db: Db, body: Record<string, unknown>): Promise<User> {
  const problems = signupProblems(body);
  if (Object.keys(problems).length) throw new ApiError(422, "invalid", "Some values are not valid.", problems);
  const email = text(body.email).trim().toLowerCase();
  const user: User = { id: newId("u"), name: text(body.name).trim(), email };
  const hash = await hashPassword(text(body.password));
  const inserted = await one<User>(
    db,
    "INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id, name, email",
    [user.id, user.name, user.email, hash],
  );
  if (!inserted) throw new ApiError(409, "email_taken", fieldError.emailTaken);
  return inserted;
}

export async function signIn(body: Record<string, unknown>): Promise<User> {
  const email = text(body.email).trim().toLowerCase();
  const row = await one<User & { password_hash: string }>(pool, "SELECT id, name, email, password_hash FROM users WHERE email = $1", [email]);
  if (!row || !(await verifyPassword(text(body.password), row.password_hash))) throw new ApiError(401, "invalid_credentials", fieldError.signInFailed);
  return { id: row.id, name: row.name, email: row.email };
}
