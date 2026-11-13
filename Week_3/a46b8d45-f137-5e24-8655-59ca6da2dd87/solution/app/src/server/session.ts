import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { now } from "./clock";
import { one, rows, type Db } from "./db";
import { fail } from "./errors";
import type { Context } from "./context";
import { headerText } from "./context";

const SESSION_COOKIE = "desk_session";

const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

export function sessionToken(ctx: Context): string | undefined {
  const cookie = headerText(ctx.headers["cookie"]);
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

export async function hasLiveSession(db: Db, token: string): Promise<boolean> {
  const found = await one<{ ok: number }>(db, "SELECT 1 AS ok FROM operator_sessions WHERE token_hash = $1 AND expires_at > $2", [digest(token), now()]);
  return found !== null;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt = "", hash = ""] = stored.split(":");
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

/** Signs the operator in and returns the cookie value, or refuses with bad_credentials. */
export async function openSession(db: Db, email: string, password: string): Promise<string> {
  const account = await one<{ password_hash: string }>(db, "SELECT password_hash FROM operator_account WHERE lower(email) = lower($1)", [email]);
  if (!account || !passwordMatches(password, account.password_hash)) return fail("bad_credentials");
  const token = randomBytes(32).toString("base64url");
  const at = now();
  await rows(db, "DELETE FROM operator_sessions WHERE expires_at <= $1", [at]);
  await rows(db, "INSERT INTO operator_sessions (token_hash, expires_at) VALUES ($1, $2)", [digest(token), new Date(at.getTime() + config.desk.operatorSessionSeconds * 1000)]);
  return token;
}

export async function closeSession(db: Db, token: string): Promise<void> {
  await rows(db, "DELETE FROM operator_sessions WHERE token_hash = $1", [digest(token)]);
}

export function sessionCookie(token: string): string {
  const maxAge = config.desk.operatorSessionSeconds;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${maxAge > 0 ? `; Max-Age=${maxAge}` : ""}`;
}

export const clearedSessionCookie = (): string => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
