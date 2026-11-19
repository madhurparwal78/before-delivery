import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config";
import { type Db, query } from "../db";
import type { Role } from "../../shared/types";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export interface Practice {
  id: string;
  reminderHour: number;
  clockNow: number | null;
}

export interface Account {
  id: string;
  practiceId: string;
  clientId: string | null;
  displayName: string;
  email: string;
  role: Role;
}

/** The practice's current instant: its frozen clock, or real time when it was never set. */
export const nowOf = (practice: Practice): number => practice.clockNow ?? Date.now();

export async function getPractice(db: Db, id: string): Promise<Practice> {
  const [row] = await query<{ id: string; reminder_hour: number; clock_now: string | null }>(
    db, "SELECT id, reminder_hour, clock_now FROM practices WHERE id = $1", [id]);
  return { id: row.id, reminderHour: row.reminder_hour, clockNow: row.clock_now ? Date.parse(row.clock_now) : null };
}

export async function createPractice(db: Db, reminderHour: number, clockNow: string | null): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO practices (id, reminder_hour, clock_now) VALUES ($1, $2, $3)", [id, reminderHour, clockNow]);
  return id;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await scryptAsync(password, salt, 32)).toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = await scryptAsync(password, Buffer.from(salt, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export async function emailTaken(db: Db, email: string): Promise<boolean> {
  return (await query(db, "SELECT 1 FROM users WHERE lower(email) = lower($1)", [email])).length > 0;
}

export async function createUser(db: Db, user: {
  practiceId: string; clientId: string | null; displayName: string; email: string; password: string; role: Role;
}): Promise<string> {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users (id, practice_id, client_id, display_name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, user.practiceId, user.clientId, user.displayName, user.email, await hashPassword(user.password), user.role]);
  return id;
}

interface AccountRow {
  id: string; practice_id: string; client_id: string | null; display_name: string; email: string; role: Role;
}

const toAccount = (row: AccountRow): Account => ({
  id: row.id, practiceId: row.practice_id, clientId: row.client_id, displayName: row.display_name,
  email: row.email, role: row.role,
});

export async function verifyCredentials(db: Db, email: string, password: string): Promise<Account | null> {
  const [row] = await query<AccountRow & { password_hash: string }>(
    db, "SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  return row && (await passwordMatches(password, row.password_hash)) ? toAccount(row) : null;
}

const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
    [digest(token), userId, config.sessionTtlSeconds]);
  return token;
}

export async function accountForSession(db: Db, token: string): Promise<Account | null> {
  const [row] = await query<AccountRow>(
    db, `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [digest(token)]);
  return row ? toAccount(row) : null;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [digest(token)]);
}

export async function bookkeeperOf(db: Db, practiceId: string): Promise<Account> {
  const [row] = await query<AccountRow>(
    db, "SELECT * FROM users WHERE practice_id = $1 AND role = 'bookkeeper' ORDER BY created_at LIMIT 1", [practiceId]);
  return toAccount(row);
}

export async function ownerOf(db: Db, clientId: string): Promise<Account> {
  const [row] = await query<AccountRow>(db, "SELECT * FROM users WHERE client_id = $1 AND role = 'owner' LIMIT 1", [clientId]);
  return toAccount(row);
}
