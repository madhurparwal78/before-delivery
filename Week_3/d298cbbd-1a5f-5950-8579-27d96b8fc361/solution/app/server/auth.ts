import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { pool } from "./db";
import type { Queryable } from "./db";
import { cookieValue } from "./http";
import { hashToken } from "./mail";

const COOKIE = "sid";
const KEY_LENGTH = 64;

export interface Viewer {
  readonly typistId: string;
  readonly name: string;
  readonly emailKey: string;
  readonly verified: boolean;
  readonly sessionHash: string;
}

export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(`${salt.toString("hex")}:${key.toString("hex")}`)));
  });
}

export function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = "", key = ""] = stored.split(":");
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, "hex"), KEY_LENGTH, (error, derived) =>
      error ? reject(error) : resolve(timingSafeEqual(derived, Buffer.from(key, "hex"))),
    );
  });
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export const clearedCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export async function openSession(db: Queryable, typistId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, typist_id) VALUES ($1, $2)", [hashToken(token), typistId]);
  return token;
}

export async function viewerOf(req: IncomingMessage): Promise<Viewer | null> {
  const token = cookieValue(req, COOKIE);
  if (!token) return null;
  const sessionHash = hashToken(token);
  const { rows } = await pool.query<{ id: string; name: string; email_key: string; verified: boolean }>(
    "SELECT t.id, t.name, t.email_key, t.verified FROM sessions s JOIN typists t ON t.id = s.typist_id WHERE s.token_hash = $1",
    [sessionHash],
  );
  const row = rows[0];
  return row ? { typistId: row.id, name: row.name, emailKey: row.email_key, verified: row.verified, sessionHash } : null;
}

export async function endSession(sessionHash: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sessionHash]);
}

/** The session hashes among `hashes` that still exist. */
export async function liveSessions(hashes: string[]): Promise<Set<string>> {
  const { rows } = await pool.query<{ token_hash: string }>("SELECT token_hash FROM sessions WHERE token_hash = ANY($1)", [hashes]);
  return new Set(rows.map((row) => row.token_hash));
}
