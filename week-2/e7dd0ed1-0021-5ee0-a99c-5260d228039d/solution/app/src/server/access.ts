// Who is calling and what they may do (brief: Business rules, Roles; Sessions; Pending sessions and
// the code step; Step-up confirmation). Sessions identify the user only; memberships and roles are
// read again on every request.
import { config } from "./config.js";
import { one, pool, query, row, type Db } from "./db.js";
import { ApiError } from "./errors.js";
import { header, truncateToSecond, type Ctx } from "./http.js";
import { newId, randomToken, sha256Hex } from "./secrets.js";

export type Role = "owner" | "developer" | "viewer";
export const ROLES: readonly Role[] = ["owner", "developer", "viewer"];

type Action =
  | "read"            // list buckets, objects, versions, replicas, lifecycle; search; download
  | "mint_link"       // mint a share link; revoke one's own link
  | "revoke_any_link"
  | "write"           // create bucket, upload, overwrite, delete, retry, lifecycle edits, retention, bulk delete
  | "legal_hold"
  | "administer";     // members, invites, access keys, usage, export, webhooks, encryption, audit trail

const ALLOWED: Record<Action, readonly Role[]> = {
  read: ["owner", "developer", "viewer"],
  mint_link: ["owner", "developer", "viewer"],
  revoke_any_link: ["owner", "developer"],
  write: ["owner", "developer"],
  legal_hold: ["owner"],
  administer: ["owner"],
};

const roleAllows = (role: Role, action: Action): boolean => ALLOWED[action].includes(role);

export interface User {
  id: string;
  email: string;
  name: string;
  operator: boolean;
  two_step_enabled_at: Date | null;
}

export interface Session {
  id: string;
  user_id: string;
  state: "pending" | "active" | "ended";
  device: string;
  created_at: Date;
  last_seen_at: Date;
  pending_until: Date | null;
  confirmed_until: Date | null;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  plan_id: string;
  status: "active" | "suspended";
}

export interface Membership {
  user: User;
  session: Session;
  // The instant this request is judged against.
  now: Date;
  workspace: Workspace;
  role: Role;
}

const SESSION_COOKIE = "fs_session";
export const sessionCookie = (token: string): string => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
export const CLEARED_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function sessionToken(ctx: Ctx): string | null {
  const cookie = header(ctx, "cookie") ?? "";
  return cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) || null;
}

// Session validity, decided once. Every limit's end second is exclusive.
export function sessionLive(session: Session, now: Date): boolean {
  const second = truncateToSecond(now).getTime();
  if (session.state === "ended") return false;
  if (second >= session.created_at.getTime() + config.sessionLifetimeSeconds * 1000) return false;
  if (second >= session.last_seen_at.getTime() + config.sessionIdleSeconds * 1000) return false;
  return session.state !== "pending" || (session.pending_until !== null && second < session.pending_until.getTime());
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

function deviceOf(ctx: Ctx): string {
  const agent = header(ctx, "user-agent")?.trim();
  if (!agent) return "Unknown device";
  return [...segmenter.segment(agent)].slice(0, 80).map((s) => s.segment).join("");
}

// Session transitions, decided here and nowhere else (brief: Sessions). A sign-in issues a session,
// pending (an enrolled user before the code step) or active, with a new token whose hash alone is
// stored. Then pending → ended and active → ended. With `pendingAt`, only a pending session still
// live at that instant is ended (the code step's guard), so a session ended meanwhile is never
// promoted. Ending answers the ids that ended.
type SessionEdge =
  | { to: "pending" | "active"; ctx: Ctx; userId: string }
  | { to: "ended"; by: { ids: string[] } | { tokenHash: string }; pendingAt?: Date };

export async function moveSessions(db: Db, edge: Extract<SessionEdge, { to: "ended" }>): Promise<string[]>;
export async function moveSessions(db: Db, edge: Exclude<SessionEdge, { to: "ended" }>): Promise<{ token: string; session: Session }>;
export async function moveSessions(db: Db, edge: SessionEdge): Promise<string[] | { token: string; session: Session }> {
  if (edge.to === "ended") {
    const { by, pendingAt } = edge;
    const target = "ids" in by ? "id = ANY($1)" : "token_hash = $1";
    const guard = pendingAt ? " AND state = 'pending' AND pending_until > $2" : "";
    const ended = await query<{ id: string }>(db, `UPDATE sessions SET state = 'ended' WHERE ${target} AND state <> 'ended'${guard} RETURNING id`,
      ["ids" in by ? by.ids : by.tokenHash, ...(pendingAt ? [truncateToSecond(pendingAt)] : [])]);
    return ended.map((e) => e.id);
  }
  const token = randomToken(32);
  const now = truncateToSecond(edge.ctx.now);
  const session = await row<Session>(db,
    `INSERT INTO sessions (id, token_hash, user_id, state, device, created_at, last_seen_at, pending_until)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7) RETURNING id, user_id, state, device, created_at, last_seen_at, pending_until, confirmed_until`,
    [newId(), sha256Hex(token), edge.userId, edge.to, deviceOf(edge.ctx), now,
      edge.to === "pending" ? new Date(now.getTime() + config.twoStepPendingSeconds * 1000) : null]);
  return { token, session };
}

export type Caller =
  | { kind: "anonymous" }
  | { kind: "ended" }
  | { kind: "pending"; session: Session; user: User }
  | { kind: "active"; session: Session; user: User };

export const USER_COLUMNS = "u.id, u.email, u.name, u.operator, u.two_step_enabled_at";

// Resolves the fs_session cookie once per request. A session found ended is marked so, and the
// response clears the cookie; an active session's last_seen_at moves to this second.
export async function caller(ctx: Ctx): Promise<Caller> {
  if (ctx.caller) return ctx.caller;
  const token = sessionToken(ctx);
  let resolved: Caller = { kind: "anonymous" };
  if (token) {
    const found = await one<Session & { user: User }>(pool,
      `SELECT s.id, s.user_id, s.state, s.device, s.created_at, s.last_seen_at, s.pending_until, s.confirmed_until,
         json_build_object('id', u.id, 'email', u.email, 'name', u.name, 'operator', u.operator,
           'two_step_enabled_at', u.two_step_enabled_at) AS user
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`, [sha256Hex(token)]);
    if (!found) {
      resolved = { kind: "ended" };
    } else {
      const { user, ...session } = found;
      const parsedUser: User = { ...user, two_step_enabled_at: user.two_step_enabled_at ? new Date(user.two_step_enabled_at) : null };
      if (!sessionLive(session, ctx.now)) {
        await moveSessions(pool, { to: "ended", by: { ids: [session.id] } });
        resolved = { kind: "ended" };
      } else if (session.state === "pending") {
        resolved = { kind: "pending", session, user: parsedUser };
      } else {
        const seen = truncateToSecond(ctx.now);
        if (seen.getTime() !== session.last_seen_at.getTime()) {
          await pool.query("UPDATE sessions SET last_seen_at = $2 WHERE id = $1 AND state = 'active'", [session.id, seen]);
        }
        resolved = { kind: "active", session: { ...session, last_seen_at: seen }, user: parsedUser };
      }
    }
    if (resolved.kind === "ended") ctx.res.setHeader("Set-Cookie", CLEARED_COOKIE);
  }
  ctx.caller = resolved;
  return resolved;
}

// A fully signed-in caller: no session or an ended one is unauthenticated; a pending one must
// finish the code step first.
export async function requireActive(ctx: Ctx): Promise<{ user: User; session: Session }> {
  const who = await caller(ctx);
  if (who.kind === "pending") throw new ApiError("two_step_required");
  if (who.kind !== "active") throw new ApiError("unauthenticated");
  return { user: who.user, session: who.session };
}

// A workspace the caller does not belong to answers 404, exactly like one that does not exist.
export async function membership(ctx: Ctx, slug: string): Promise<Membership> {
  const { user, session } = await requireActive(ctx);
  const found = await one<Workspace & { role: Role }>(pool,
    `SELECT w.id, w.slug, w.name, w.plan_id, w.status, m.role FROM workspaces w
     JOIN members m ON m.workspace_id = w.id AND m.user_id = $2 WHERE w.slug = $1`, [slug, user.id]);
  if (!found) throw new ApiError("not_found");
  const { role, ...workspace } = found;
  return { user, session, workspace, role, now: ctx.now };
}

// The step-up check: an enrolled member needs a live confirmation made by this session.
function stepUpConfirmed(user: User, session: Session, now: Date): boolean {
  return user.two_step_enabled_at === null ||
    (session.confirmed_until !== null && truncateToSecond(now).getTime() < session.confirmed_until.getTime());
}

// Role, then step-up confirmation, then suspension, in the order of the error precedence. A role
// refusal carries what the audit trail records about it.
export function authorize(m: Membership, action: Action, blockedWhileSuspended = false, sensitive = false): void {
  if (!roleAllows(m.role, action)) {
    throw new ApiError("forbidden", undefined, {}, undefined, { workspaceSlug: m.workspace.slug, actor: m.user.email });
  }
  if (sensitive && !stepUpConfirmed(m.user, m.session, m.now)) throw new ApiError("step_up_required");
  if (blockedWhileSuspended && m.workspace.status === "suspended") throw new ApiError("workspace_suspended");
}

const OPERATOR_ONLY = "This area is for the Farshore operator.";

// Every /api/ops path is decided right after authentication, before any lookup.
export async function requireOperator(ctx: Ctx): Promise<User> {
  const { user } = await requireActive(ctx);
  if (!user.operator) throw new ApiError("forbidden", OPERATOR_ONLY);
  return user;
}
