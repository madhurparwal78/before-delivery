// Members, passwords and sessions. The role is read from the database on every request.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { type Queryable } from "./db.js";
import { type Role } from "./rules/roles.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  stationId: string;
  stationName: string;
  timeZone: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** 32 random bytes, URL-safe: 43 characters. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const MEMBER_COLUMNS = `m.id, m.name, m.email, m.role, m.station_id AS "stationId", s.name AS "stationName", s.time_zone AS "timeZone"`;

export async function sessionMember(db: Queryable, token: string): Promise<Member | null> {
  const r = await db.query<Member>(
    `SELECT ${MEMBER_COLUMNS} FROM sessions x JOIN members m ON m.id = x.member_id JOIN stations s ON s.id = m.station_id
     WHERE x.token_hash = $1 AND m.status = 'active'`,
    [tokenHash(token)],
  );
  return r.rows[0] ?? null;
}

export async function memberById(db: Queryable, id: string): Promise<Member> {
  const r = await db.query<Member>(`SELECT ${MEMBER_COLUMNS} FROM members m JOIN stations s ON s.id = m.station_id WHERE m.id = $1`, [id]);
  return r.rows[0];
}

export async function startSession(db: Queryable, memberId: string): Promise<string> {
  const token = newToken();
  await db.query("INSERT INTO sessions (token_hash, member_id) VALUES ($1, $2)", [tokenHash(token), memberId]);
  return token;
}

export function sessionCookie(name: string, token: string): string {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function userBody(m: Member): { user: Member } {
  return { user: { id: m.id, name: m.name, email: m.email, role: m.role, stationId: m.stationId, stationName: m.stationName, timeZone: m.timeZone } };
}
