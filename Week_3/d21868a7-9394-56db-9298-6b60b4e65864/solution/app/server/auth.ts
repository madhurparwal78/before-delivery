// Accounts, passwords and sessions. Only the seeded district people sign in.
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "./db.ts";
import { ApiError, FieldErrors, asRecord } from "./http.ts";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

import type { Role } from "../shared/roles.ts";

export type { Role };

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  operator_code: string | null;
}

export const SESSION_COOKIE = "ditchbook_session";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt = "", key = ""] = stored.split("$");
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const USER_COLUMNS = "p.id, p.name, p.email, p.role, p.operator_code";

export async function signIn(db: Db, body: unknown): Promise<{ user: User; token: string }> {
  const { email, password } = asRecord(body);
  const errors = new FieldErrors();
  if (typeof email !== "string") errors.add("email", "Enter your email.");
  if (typeof password !== "string") errors.add("password", "Enter your password.");
  errors.throwIfAny();
  const found = await db.query<User & { password_hash: string | null }>(
    `SELECT ${USER_COLUMNS}, p.password_hash FROM person p WHERE lower(p.email) = lower($1)`,
    [email],
  );
  const person = found.rows[0];
  if (!person?.password_hash || !(await passwordMatches(password as string, person.password_hash))) {
    throw new ApiError(401, "bad_credentials", "That email and password do not match.");
  }
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO session (token_hash, person_id) VALUES ($1, $2)", [tokenHash(token), person.id]);
  const { password_hash: _hidden, ...user } = person;
  return { user, token };
}

export async function signOut(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM session WHERE token_hash = $1", [tokenHash(token)]);
}

export async function sessionUser(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const found = await db.query<User>(
    `SELECT ${USER_COLUMNS} FROM session s JOIN person p ON p.id = s.person_id WHERE s.token_hash = $1`,
    [tokenHash(token)],
  );
  return found.rows[0] ?? null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
