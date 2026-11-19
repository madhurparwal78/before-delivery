import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { maybeOne, run, type Db } from "./db.ts";

export const SESSION_COOKIE = "fs_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split("$") as [string, string, string];
  const candidate = scryptSync(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** An unguessable token: sessions and invite links. */
export function randomToken(): string {
  return randomBytes(24).toString("hex");
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomToken();
  await run(db, "INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
  return token;
}

export async function userOfSession(db: Db, token: string | undefined): Promise<SessionUser | undefined> {
  if (!token || !/^[0-9a-f]{48}$/.test(token)) return undefined;
  return maybeOne<SessionUser>(db, "SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1", [token]);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function cookieValue(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
}
