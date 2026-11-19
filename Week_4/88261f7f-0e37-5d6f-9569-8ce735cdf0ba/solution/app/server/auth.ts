import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import type { Role, User } from "../shared/api";
import { database, one, run, type Row } from "./db";
import { fail, parseCookies } from "./http";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const KEY_LENGTH = 32;
const SESSION_COOKIE = "nightroll_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = await scryptAsync(password, Buffer.from(salt, "hex"), KEY_LENGTH);
  return timingSafeEqual(derived, Buffer.from(key, "hex"));
}

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

interface UserRow extends Row { id: string; email: string; name: string; role: Role; hotel_id: string; password_hash: string }

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, role: row.role, hotelId: row.hotel_id };
}

/** Starts a session for the email and password, or returns null. */
export async function signIn(email: string, password: string): Promise<{ user: User; cookie: string } | null> {
  const row = await one<UserRow>(database(), "SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  if (!row || !(await passwordMatches(password, row.password_hash))) return null;
  const token = randomBytes(32).toString("base64url");
  await run(database(), "INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [tokenHash(token), row.id]);
  const cookie = `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
  return { user: toUser(row), cookie };
}

export async function signOut(req: IncomingMessage): Promise<string> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await run(database(), "DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

async function sessionUser(req: IncomingMessage): Promise<User | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = await one<UserRow>(
    database(),
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.created_at > now() - make_interval(secs => $2)`,
    [tokenHash(token), SESSION_SECONDS],
  );
  return row ? toUser(row) : null;
}

/** 401 when signed out, 404 when the role may not open the route. */
export async function requireRole(req: IncomingMessage, roles: readonly Role[]): Promise<User> {
  const user = await sessionUser(req);
  if (!user) throw fail.signIn();
  if (!roles.includes(user.role)) throw fail.notFound();
  return user;
}

export async function currentUser(req: IncomingMessage): Promise<User> {
  const user = await sessionUser(req);
  if (!user) throw fail.signIn();
  return user;
}
