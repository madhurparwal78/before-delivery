// Accounts sign in with a session cookie signed by APP_SECRET; the role is read fresh on every request.
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.ts";
import { db } from "./db/index.ts";

export const ROLES = ["visitor", "group_booker", "artist", "curator", "box_office", "finance", "admin"] as const;
export type Role = (typeof ROLES)[number];
export type User = { id: string; email: string; name: string; role: Role; organisation_id: string | null };

const COOKIE = "kerf_session";
const SESSION_DAYS = 30;
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

let secret = "";

/** APP_SECRET, or one random secret created once and kept in Postgres so every instance agrees. */
export async function loadAppSecret(): Promise<void> {
  if (config.appSecret) {
    secret = config.appSecret;
    return;
  }
  await db.query("INSERT INTO settings (key, value) VALUES ('app_secret', $1) ON CONFLICT (key) DO NOTHING", [randomBytes(32).toString("hex")]);
  secret = (await db.one<{ value: string }>("SELECT value FROM settings WHERE key = 'app_secret'"))!.value;
}

export function sign(value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function signatureMatches(value: string, signature: string): boolean {
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  const expected = Buffer.from(hash ?? "", "base64");
  const actual = await scryptAsync(password, Buffer.from(salt ?? "", "base64"), 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function startLoginSession(userId: string): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await db.query("INSERT INTO login_sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    [id, userId, new Date(now), new Date(now + SESSION_DAYS * 86_400_000)]);
  return `${COOKIE}=${id}.${sign(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`;
}

function sessionId(cookieHeader: string | undefined): string | null {
  const raw = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  const [id, signature] = (raw?.slice(COOKIE.length + 1) ?? "").split(".");
  return id && signature && signatureMatches(id, signature) ? id : null;
}

export async function endLoginSession(cookieHeader: string | undefined): Promise<string> {
  const id = sessionId(cookieHeader);
  if (id) await db.query("DELETE FROM login_sessions WHERE id = $1", [id]);
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function userFromCookie(cookieHeader: string | undefined): Promise<User | null> {
  const id = sessionId(cookieHeader);
  if (!id) return null;
  return db.one<User>(
    `SELECT u.id, u.email, u.name, u.role, u.organisation_id FROM login_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND is_live(s.expires_at, $2)`, [id, new Date()]);
}
