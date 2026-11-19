import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Member, MemberStatus, Role, Workspace, WorkspaceState } from "../shared/types.js";
import { isoInstant } from "../shared/time.js";
import { config } from "./config.js";
import { sql, type Db } from "./db.js";
import { HttpError, type Context } from "./http.js";
import { isWritable, settleEndedTrials } from "./subscription.js";

const COOKIE = "tidemark_session";

export type MemberRow = {
  id: string;
  workspace_id: string | null;
  role: Role;
  status: MemberStatus;
  name: string | null;
  email: string;
  time_zone: string;
  threshold_minutes: number;
};

export type WorkspaceRow = { id: string; name: string; state: WorkspaceState; trial_ends_at: Date };

export type Planner = { member: MemberRow & { workspace_id: string }; workspace: WorkspaceRow };
/** The operator is the only account in no workspace (a database check constraint). */
type Caller = Planner | { member: MemberRow; workspace: null };

export function memberJson(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    timeZone: row.time_zone,
    thresholdMinutes: row.threshold_minutes,
  };
}

export function workspaceJson(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    trialEndsAt: isoInstant(row.trial_ends_at.getTime()),
    writable: isWritable(row.state),
  };
}

/** URL-safe random secret: feed tokens, invite tokens and sign-in cookies. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}

export async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  const [scheme, salt, key] = (stored ?? "").split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Starts a signed-in session and returns the Set-Cookie header for it. */
export async function signIn(db: Db, memberId: string): Promise<string> {
  const token = newToken();
  await db`INSERT INTO sign_ins (token_hash, member_id, expires_at)
           VALUES (${hashToken(token)}, ${memberId}, now() + make_interval(secs => ${config.sessionTtlSeconds}))`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}`;
}

export function clearedCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function signOut(ctx: Context): Promise<void> {
  const token = ctx.cookies[COOKIE];
  if (token) await sql`DELETE FROM sign_ins WHERE token_hash = ${hashToken(token)}`;
}

/** The signed-in caller, with the trial clock checked on this request. 401 when there is none. */
export async function caller(ctx: Context): Promise<Caller> {
  const token = ctx.cookies[COOKIE];
  const [found] = token
    ? await sql<{ member_id: string }[]>`
        SELECT s.member_id FROM sign_ins s JOIN members m ON m.id = s.member_id
        WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now() AND m.removed_at IS NULL`
    : [];
  if (!found) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  return loadCaller(found.member_id);
}

export async function loadCaller(memberId: string): Promise<Caller> {
  const [member] = await sql<MemberRow[]>`
    SELECT id, workspace_id, role, status, name, email, time_zone, threshold_minutes FROM members WHERE id = ${memberId}`;
  const workspaceId = member.workspace_id;
  if (workspaceId === null) return { member, workspace: null };
  await settleEndedTrials(Date.now(), workspaceId);
  const [workspace] = await sql<WorkspaceRow[]>`
    SELECT id, name, state, trial_ends_at FROM workspaces WHERE id = ${workspaceId}`;
  return { member: { ...member, workspace_id: workspaceId }, workspace };
}

function forbidden(): HttpError {
  return new HttpError(403, "forbidden", "Your role can't use this.");
}

/** Owners and members planning their own days; the operator is refused. */
export async function planner(ctx: Context): Promise<Planner> {
  const found = await caller(ctx);
  if (found.workspace === null) throw forbidden();
  return found;
}

export function requireOwner(found: Planner): void {
  if (found.member.role !== "owner") throw forbidden();
}

export async function operator(ctx: Context): Promise<void> {
  const { member } = await caller(ctx);
  if (member.role !== "operator") throw forbidden();
}

export function requireWritable(workspace: WorkspaceRow): void {
  if (!isWritable(workspace.state)) {
    throw new HttpError(402, "workspace_read_only", "This workspace is read-only.");
  }
}
