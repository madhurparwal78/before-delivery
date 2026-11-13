import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Role } from "../shared/api";
import { one, type Queryable } from "./db";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Session {
  id: string;
  user: SessionUser | null;
  /** Cart and wishlist owner: the account when signed in, else the guest session. */
  owner: string;
}

export function ownerOf(sessionId: string, userId: string | null): string {
  return userId ? `user:${userId}` : `session:${sessionId}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (failure, key) => (failure ? reject(failure) : resolve(key)));
  });
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await derive(password, Buffer.from(salt, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newSessionId(): string {
  return randomBytes(24).toString("base64url");
}

export async function loadSession(db: Queryable, id: string): Promise<Session | null> {
  const row = await one<{ id: string; user_id: string | null; name: string | null; email: string | null; role: Role | null }>(
    db,
    `SELECT s.id, s.user_id, u.name, u.email, u.role FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [id],
  );
  if (!row) return null;
  const user = row.user_id && row.name && row.email && row.role ? { id: row.user_id, name: row.name, email: row.email, role: row.role } : null;
  return { id: row.id, user, owner: ownerOf(row.id, row.user_id) };
}

export async function createSession(db: Queryable, userId: string | null): Promise<string> {
  const id = newSessionId();
  await db.query("INSERT INTO sessions (id, user_id) VALUES ($1, $2)", [id, userId]);
  return id;
}


