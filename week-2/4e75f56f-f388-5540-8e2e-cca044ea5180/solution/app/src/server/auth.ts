import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import { one, pool, type Db } from "./db.js";
import { newId } from "./reservations.js";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export type Role = "practitioner" | "clinic" | "director" | "registrar" | "frontdesk";
export const BUYER_ROLES: readonly Role[] = ["practitioner", "clinic"];

export interface Account {
  id: string;
  name: string;
  email: string;
  email_key: string;
  role: Role;
  clinic_name: string | null;
}

const SESSION_COOKIE = "ob_session";

/** The name a buyer goes by: the clinic name for a clinic. */
export function buyerDisplayName(role: Role, name: string, clinicName: string | null): string {
  return role === "clinic" ? (clinicName ?? name) : name;
}

export function accountView(account: Account) {
  return { id: account.id, name: account.name, email: account.email, role: account.role };
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A cryptographically random session token; only its hash is stored in Postgres. */
export async function createSession(db: Db, accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)", [tokenHash(token), accountId]);
  return token;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export const CLEARED_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function sessionToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

export async function accountForSession(token: string | null): Promise<Account | null> {
  if (!token) return null;
  return one<Account>(
    pool,
    `SELECT a.id, a.name, a.email, a.email_key, a.role, a.clinic_name FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1`,
    [tokenHash(token)],
  );
}

export async function endSession(token: string | null): Promise<void> {
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export async function findAccountByEmail(db: Db, email: string): Promise<(Account & { password_hash: string }) | null> {
  return one(db, "SELECT * FROM accounts WHERE email_key = $1", [email.trim().toLowerCase()]);
}

export async function insertAccount(
  db: Db,
  fields: { name: string; email: string; password: string; role: Role; clinicName: string | null },
): Promise<Account | null> {
  return one<Account>(
    db,
    `INSERT INTO accounts (id, name, email, email_key, password_hash, role, clinic_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (email_key) DO NOTHING
     RETURNING id, name, email, email_key, role, clinic_name`,
    [newId("acc"), fields.name, fields.email.trim(), fields.email.trim().toLowerCase(), await hashPassword(fields.password), fields.role, fields.clinicName],
  );
}

// Seed data printed in the brief (Seed data › Staff accounts); hashed with scrypt on first start.
const STAFF: readonly { role: Role; name: string; email: string; password: string }[] = [
  { role: "director", name: "Mara Okonkwo-Lindqvist", email: "director@opaline-institute.test", password: "bench-days-director-2027" },
  { role: "registrar", name: "Theo Vasquez-Hale", email: "registrar@opaline-institute.test", password: "bench-days-registrar-2027" },
  { role: "frontdesk", name: "Priya Anand-Sorensen", email: "frontdesk@opaline-institute.test", password: "bench-days-frontdesk-2027" },
];

export async function seedStaff(db: Db): Promise<void> {
  for (const member of STAFF) {
    if (!(await findAccountByEmail(db, member.email))) {
      await insertAccount(db, { name: member.name, email: member.email, password: member.password, role: member.role, clinicName: null });
    }
  }
}
