// Who is calling, what their role may do, and which projects they can see.
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { IncomingMessage } from "node:http";
import type { Role } from "../shared/types";
import { ApiError, forbidden, notFound } from "./http";
import { one, rows, type Db } from "./db";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const COOKIE = "lowfield_session";

import { allows, type Action } from "../shared/permissions";

export interface Caller {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: Role;
  /** Every project of the organisation for admins and billing viewers, else the assigned ones. */
  projectIds: string[];
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  const candidate = await scrypt(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export function cookieToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=") || null;
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function clearedCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Requests whose Origin is another site's, and the callers authenticated on them: each is refused at the
 * 403 step, after any 413/415, 401 and 404, as the brief's error precedence orders it. A signed-in one is
 * refused by `permit`; a signed-out route calls `refuseForeignOrigin` at that step itself. */
const foreign = new WeakSet<IncomingMessage>();
const foreignCallers = new WeakSet<Caller>();
export function markForeignOrigin(req: IncomingMessage): void {
  foreign.add(req);
}
const crossOrigin = () => new ApiError(403, "cross_origin", "Requests must come from the console's own origin.");
export function refuseForeignOrigin(req: IncomingMessage): void {
  if (foreign.has(req)) throw crossOrigin();
}
const invalidKey = () => new ApiError(401, "invalid_key", "The API key is missing, unknown or revoked.");

export async function loadCaller(memberId: string, db?: Db): Promise<Caller | undefined> {
  const member = await one<Omit<Caller, "projectIds">>(
    "SELECT id, org_id, name, email, role FROM members WHERE id = $1 AND removed_at IS NULL",
    [memberId],
    db,
  );
  if (!member) return undefined;
  const sees = member.role === "admin" || member.role === "billing";
  const projects = await rows<{ id: string }>(
    sees
      ? "SELECT id FROM projects WHERE org_id = $1 ORDER BY created_at, name"
      : "SELECT p.id FROM projects p JOIN member_projects mp ON mp.project_id = p.id WHERE mp.member_id = $2 AND p.org_id = $1 ORDER BY p.created_at, p.name",
    sees ? [member.org_id] : [member.org_id, member.id],
    db,
  );
  return { ...member, projectIds: projects.map((p) => p.id) };
}

/** The signed-in member, read fresh on every request so role and assignment changes apply at once. */
export async function authenticate(req: IncomingMessage): Promise<Caller> {
  const token = cookieToken(req);
  const row = token ? await one<{ member_id: string }>("SELECT member_id FROM auth_sessions WHERE token_hash = $1", [sha256(token)]) : undefined;
  const caller = row ? await loadCaller(row.member_id) : undefined;
  if (!caller) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  if (foreign.has(req)) foreignCallers.add(caller);
  return caller;
}

export function permit(caller: Caller, action: Action): void {
  if (foreignCallers.has(caller)) throw crossOrigin();
  if (!allows(caller.role, action)) throw forbidden();
}

function canSee(caller: Caller, projectId: string): boolean {
  return caller.projectIds.includes(projectId);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** A project the caller can see, else 404 (unknown, other organisation, or not assigned). */
export async function visibleProject(caller: Caller, projectId: string): Promise<{ id: string; org_id: string; name: string; quota_minutes: number }> {
  if (!isUuid(projectId) || !canSee(caller, projectId)) throw notFound();
  const project = await one<{ id: string; org_id: string; name: string; quota_minutes: number }>(
    "SELECT id, org_id, name, quota_minutes FROM projects WHERE id = $1 AND org_id = $2",
    [projectId, caller.org_id],
  );
  if (!project) throw notFound();
  return project;
}

/** A session in one of the caller's visible projects, else 404. */
export async function visibleSessionProject(caller: Caller, sessionId: string): Promise<{ project_id: string; org_id: string }> {
  const row = isUuid(sessionId)
    ? await one<{ project_id: string; org_id: string }>(
        "SELECT s.project_id, p.org_id FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = $1",
        [sessionId],
      )
    : undefined;
  if (!row || row.org_id !== caller.org_id || !canSee(caller, row.project_id)) throw notFound();
  return row;
}

interface KeyOwner {
  id: string;
  project_id: string;
  org_id: string;
}

/** The active key presented as `Authorization: Token <key>`, else 401 invalid_key. */
export async function authenticateKey(req: IncomingMessage): Promise<KeyOwner> {
  const header = req.headers.authorization ?? "";
  const secret = /^Token\s+(\S+)$/.exec(header)?.[1];
  const key = secret
    ? await one<KeyOwner>(
        "SELECT k.id, k.project_id, p.org_id FROM api_keys k JOIN projects p ON p.id = k.project_id WHERE k.secret_hash = $1 AND k.revoked_at IS NULL",
        [sha256(secret)],
      )
    : undefined;
  if (!key) throw invalidKey();
  return key;
}
