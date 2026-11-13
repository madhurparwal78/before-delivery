// Sign-in, sessions and password hashing. The server alone decides that a session has ended.

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Role, SessionView } from "../shared/api";
import { wholeSeconds } from "../shared/time";
import { config } from "./config";
import { one, pool, type Db } from "./db";
import { ApiError } from "./errors";
import type { Caller, SessionLookup } from "./http";

const COOKIE = "ocotillo_session";
const KEY_BYTES = 32;

const HOMES: Record<Role, string> = {
  member: "/me",
  owner: "/staff/members",
  specialist: "/staff/results",
  coordinator: "/staff/calendar",
  billingLead: "/staff/receipts",
};

export const homeOf = (role: Role): string => HOMES[role];

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = "", key = ""] = stored.split(":");
  const candidate = await derive(password, Buffer.from(salt, "hex"));
  const expected = Buffer.from(key, "hex");
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

// A hash nobody's password matches, so an unknown email costs the same as a wrong password.
const NOBODY = hashPassword(randomBytes(16).toString("hex"));

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

function cookieValue(header: string | undefined): string | null {
  for (const piece of (header ?? "").split(";")) {
    const [name, value] = piece.trim().split("=");
    if (name === COOKIE && value) return value;
  }
  return null;
}

export async function readSession(cookieHeader: string | undefined): Promise<SessionLookup> {
  const token = cookieValue(cookieHeader);
  if (!token) return { kind: "none" };
  const hash = tokenHash(token);
  const row = await one<{ id: string; name: string; role: Role; expires_at: Date }>(
    pool,
    `SELECT p.id, p.name, p.role, s.expires_at FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hash],
  );
  if (!row) return { kind: "ended" };
  const caller: Caller = { id: row.id, name: row.name, role: row.role, tokenHash: hash, expiresAt: row.expires_at };
  return { kind: "live", caller };
}

export async function openSession(db: Db, personId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, person_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))", [
    tokenHash(token),
    personId,
    config.sessionSeconds,
  ]);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

const SIGN_IN_COPY = "That email and password don't match.";

export async function signIn(email: string, password: string): Promise<{ user: { id: string; name: string; role: Role }; cookie: string }> {
  const row = await one<{ id: string; name: string; role: Role; password_hash: string }>(
    pool,
    "SELECT id, name, role, password_hash FROM people WHERE lower(email) = lower($1) AND password_hash IS NOT NULL",
    [email],
  );
  const matches = await passwordMatches(password, row?.password_hash ?? (await NOBODY));
  if (!row || !matches) throw new ApiError(401, "sign_in_failed", SIGN_IN_COPY);
  return { user: { id: row.id, name: row.name, role: row.role }, cookie: await openSession(pool, row.id) };
}

export function sessionView(caller: Caller): SessionView {
  return {
    user: { id: caller.id, name: caller.name, role: caller.role },
    home: homeOf(caller.role),
    expiresAt: wholeSeconds(caller.expiresAt),
  };
}

export async function endSession(caller: Caller): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [caller.tokenHash]);
}

export async function changePassword(caller: Caller, current: string, next: string): Promise<boolean> {
  const row = await one<{ password_hash: string }>(pool, "SELECT password_hash FROM people WHERE id = $1", [caller.id]);
  if (!row || !(await passwordMatches(current, row.password_hash))) return false;
  await pool.query("UPDATE people SET password_hash = $2 WHERE id = $1", [caller.id, await hashPassword(next)]);
  await pool.query("DELETE FROM sessions WHERE person_id = $1 AND token_hash <> $2", [caller.id, caller.tokenHash]);
  return true;
}
