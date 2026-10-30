import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";
import { one, type Db } from "./db.js";
import { forbidden } from "./http/errors.js";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const ROLES = ["director", "project_lead", "designer", "finance", "client_approver", "contractor"] as const;
export type Role = (typeof ROLES)[number];
export const STUDIO_ROLES: readonly Role[] = ["director", "project_lead", "designer", "finance"];
export const STUDIO_ORGANISATION = "Marrow Hall Interiors";

export interface Member {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  brandId: string | null;
  companyId: string | null;
  organisation: string;
  status: "active" | "removed";
  approvalLimits: { HKD: number; SGD: number } | null;
  version: number;
}

/** Selects one member row with its organisation as the columns `memberFromRow` reads. */
export const MEMBER_COLUMNS = `m.id, m.email, m.name, m.phone, m.role, m.brand_id, m.company_id, m.status, m.version,
  m.approval_limit_hkd, m.approval_limit_sgd,
  CASE WHEN m.role = 'client_approver' THEN b.name WHEN m.role = 'contractor' THEN c.name ELSE '${STUDIO_ORGANISATION}' END AS organisation`;
export const MEMBER_FROM = `members m LEFT JOIN brands b ON b.id = m.brand_id LEFT JOIN companies c ON c.id = m.company_id`;

interface MemberRow {
  id: string; email: string; name: string; phone: string | null; role: Role; brand_id: string | null;
  company_id: string | null; status: "active" | "removed"; version: number; organisation: string;
  approval_limit_hkd: number | null; approval_limit_sgd: number | null;
}

export function memberFromRow(row: MemberRow): Member {
  return {
    id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role, brandId: row.brand_id,
    companyId: row.company_id, organisation: row.organisation, status: row.status, version: row.version,
    approvalLimits: row.role === "project_lead" ? { HKD: Number(row.approval_limit_hkd ?? 0), SGD: Number(row.approval_limit_sgd ?? 0) } : null,
  };
}

export async function memberById(db: Db, id: string): Promise<Member | undefined> {
  const row = await one<MemberRow>(db, `SELECT ${MEMBER_COLUMNS} FROM ${MEMBER_FROM} WHERE m.id = $1`, [id]);
  return row && memberFromRow(row);
}

export async function memberByEmail(db: Db, email: string): Promise<(Member & { passwordHash: string | null }) | undefined> {
  const row = await one<MemberRow & { password_hash: string | null }>(db,
    `SELECT ${MEMBER_COLUMNS}, m.password_hash FROM ${MEMBER_FROM} WHERE lower(m.email) = lower($1)`, [email.trim()]);
  return row && { ...memberFromRow(row), passwordHash: row.password_hash };
}

export const isStudio = (member: Member): boolean => STUDIO_ROLES.includes(member.role);

/** `{id, name, role, organisation}` — how a member appears inside another record, for everyone. */
export const memberRef = (member: Pick<Member, "id" | "name" | "role" | "organisation">) =>
  ({ id: member.id, name: member.name, role: member.role, organisation: member.organisation });

/** Refuses with 403 forbidden unless the member has one of the roles. */
export function requireRole(member: Member, ...roles: Role[]): void {
  if (!roles.includes(member.role)) throw forbidden();
}

// Passwords

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

// Tokens: 32 random bytes in base64url, stored only as their SHA-256.

export const newToken = (): string => randomBytes(32).toString("base64url");
export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

// Sessions

export const SESSION_COOKIE = "plumbline_session";

export async function startSession(db: Db, memberId: string): Promise<string> {
  const token = newToken();
  await db.query("INSERT INTO sessions (token_hash, member_id) VALUES ($1, $2)", [tokenHash(token), memberId]);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export const endedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** The live session's member, touching its idle clock, or undefined when it is missing, ended or idle too long. */
export async function sessionMember(db: Db, token: string): Promise<Member | undefined> {
  const session = await one<{ member_id: string }>(db,
    `UPDATE sessions SET last_seen_at = now()
     WHERE token_hash = $1 AND ended_at IS NULL AND last_seen_at > now() - make_interval(secs => $2)
     RETURNING member_id`, [tokenHash(token), config.sessionIdleTimeoutSeconds]);
  return session && memberById(db, session.member_id);
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.query("UPDATE sessions SET ended_at = now() WHERE token_hash = $1", [tokenHash(token)]);
}
