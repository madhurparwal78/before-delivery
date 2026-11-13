import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Actor } from "./access";
import { one, query } from "./db";
import { AppError } from "./errors";
import { hub } from "./live";

const SESSION_COOKIE = "gatecut_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, Buffer.from(salt, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

interface PersonRow {
  id: string;
  name: string;
  email: string;
  handle: string;
  is_owner: boolean;
}

function readCookie(header: string | undefined): string | null {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

export interface Session {
  sessionId: string;
  actor: Actor;
}

export async function sessionFromCookie(header: string | undefined): Promise<Session | null> {
  const sessionId = readCookie(header);
  if (!sessionId) return null;
  const person = await one<PersonRow>(
    "SELECT p.id, p.name, p.email, p.handle, p.is_owner FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.id = $1",
    [sessionId],
  );
  return person ? { sessionId, actor: person } : null;
}

export async function signIn(email: unknown, password: unknown): Promise<Session> {
  const row =
    typeof email === "string" && typeof password === "string"
      ? await one<PersonRow & { password_hash: string }>(
          "SELECT id, name, email, handle, is_owner, password_hash FROM people WHERE lower(email) = lower($1)",
          [email.trim()],
        )
      : undefined;
  if (!row || typeof password !== "string" || !passwordMatches(password, row.password_hash)) throw new AppError("bad_credentials");
  const sessionId = randomBytes(32).toString("hex");
  await query("INSERT INTO sessions (id, person_id) VALUES ($1, $2)", [sessionId, row.id]);
  const { password_hash: _hash, ...person } = row;
  return { sessionId, actor: person };
}

export async function signOut(sessionId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
  hub.closeSession(sessionId);
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`;
}

export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
