// Members, passwords, sessions and roles. Passwords are salted scrypt hashes; session tokens and partner keys
// are kept only as SHA-256 digests.
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";
import { one, pool } from "./db.js";
import { refuse } from "./errors.js";
import type { Ctx } from "./http.js";
import { workspaceBySlug, type Workspace } from "./workspaces.js";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export const ROLES = ["compliance_officer", "compliance_analyst", "operations_lead", "finance_lead", "support_agent"] as const;
export type Role = (typeof ROLES)[number];
export const SESSION_COOKIE = "lanternline_session";

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split("$");
  const hash = await scrypt(password, Buffer.from(saltHex, "hex"), 32);
  return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

export const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export interface Member {
  id: string;
  workspaceSlug: string;
  name: string;
  email: string;
  role: Role;
}

export interface Staff {
  member: Member;
  workspace: Workspace;
}

interface SessionRow {
  expires_at: Date;
  id: string;
  workspace_slug: string;
  name: string;
  email: string;
  role: Role;
  removed_at: Date | null;
}

const DUMMY_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(64)}`;

/** The identical refusal for an unknown email and a wrong password, after the same amount of work. */
export async function checkCredentials(email: string, password: string): Promise<Member | null> {
  const row = await one<{ id: string; workspace_slug: string; name: string; email: string; role: Role; password_hash: string }>(
    pool, "SELECT * FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL", [email]);
  const matches = await passwordMatches(password, row?.password_hash ?? DUMMY_HASH);
  return row && matches ? { id: row.id, workspaceSlug: row.workspace_slug, name: row.name, email: row.email, role: row.role } : null;
}

export async function startSession(member: Member): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions (token_hash, member_id, created_at, expires_at) VALUES ($1, $2, now(), now() + make_interval(secs => $3))",
    [digest(token), member.id, config.timers.session]);
  return token;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export const CLEARED_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** Rung 3: unauthenticated, access removed or session ended. */
export async function currentMember(ctx: Ctx): Promise<Member> {
  const token = ctx.cookie(SESSION_COOKIE);
  const row = token
    ? await one<SessionRow>(pool,
      `SELECT s.expires_at, m.id, m.workspace_slug, m.name, m.email, m.role, m.removed_at
         FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = $1`, [digest(token)])
    : null;
  if (!row) throw refuse.unauthenticated();
  if (row.removed_at) throw refuse.accessRemoved();
  if (row.expires_at.getTime() <= Date.now()) throw refuse.sessionEnded();
  return { id: row.id, workspaceSlug: row.workspace_slug, name: row.name, email: row.email, role: row.role };
}

/** A staff request under /api/w/<slug>: the slug must exist and the session must belong to that workspace. */
export async function staff(ctx: Ctx): Promise<Staff> {
  const workspace = workspaceBySlug(ctx.params.slug);
  if (!workspace) throw refuse.notFound();
  const member = await currentMember(ctx);
  if (member.workspaceSlug !== workspace.slug) throw refuse.notFound();
  return { member, workspace };
}

/** Rung 5: the roles published for an endpoint. */
export function allow(who: Staff, ...roles: Role[]): void {
  if (!roles.includes(who.member.role)) throw refuse.forbidden();
}
