import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pool } from "./db.ts";
import type { Role } from "./text.ts";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** Passwords are stored only as salted scrypt hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltText, keyText] = stored.split("$");
  const expected = Buffer.from(keyText, "base64");
  const actual = await scrypt(password, Buffer.from(saltText, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Session tokens carry 256 bits of randomness; the database holds only their SHA-256. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
  tokenHash: string;
}

export async function actorForToken(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const hash = tokenHash(token);
  const { rows } = await pool.query(
    "select u.id, u.name, u.email, u.role from sessions s join users u on u.id = s.user_id where s.token_hash = $1",
    [hash],
  );
  return rows[0] ? { ...(rows[0] as Omit<Actor, "tokenHash">), tokenHash: hash } : null;
}
