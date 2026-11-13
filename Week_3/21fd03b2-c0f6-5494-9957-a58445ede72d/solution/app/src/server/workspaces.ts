import { COPY } from "../shared/copy";
import { validName } from "../shared/params";
import { CAN_EDIT, OWNER_ONLY, logActivity, requireMember, requireRole, type Role } from "./access";
import { emailKey } from "./auth";
import { config } from "./config";
import { pool, one, tx, type Db } from "./db";
import { ApiError, notFound, validation } from "./errors";
import { route, type Ctx, type Reply } from "./http";
import { newId, newToken } from "./ids";
import { deliverNow, enqueueMail, inviteMail, roleMail } from "./mail";
import { valkey } from "./services/valkey";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const record = (body: unknown): Record<string, unknown> => (typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const roleLabel = (role: string): string => (role === "editor" ? "Editor" : "Viewer");

interface InviteRow {
  id: string;
  workspace_id: string;
  email: string;
  email_key: string;
  role: "editor" | "viewer";
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  reason: string | null;
  inviter_id: string;
  expires_at: Date;
}

/** An invite whose expiry has passed reads as expired in every response. */
function effectiveStatus(invite: InviteRow, now: Date): InviteRow["status"] {
  return invite.status === "pending" && invite.expires_at.getTime() <= now.getTime() ? "expired" : invite.status;
}

const inviteJson = (invite: InviteRow, now: Date): Record<string, unknown> => ({
  id: invite.id,
  email: invite.email,
  role: invite.role,
  status: effectiveStatus(invite, now),
  expiresAt: invite.expires_at.toISOString(),
});

function illegalEdge(invite: InviteRow, now: Date): ApiError | null {
  const status = effectiveStatus(invite, now);
  if (status === "accepted") return new ApiError(409, "invite_used", "This invite has already been used.");
  if (status === "revoked") return invite.reason === "superseded" ? new ApiError(410, "invite_superseded", "This invite was replaced by a newer one.") : new ApiError(410, "invite_revoked", "This invite was withdrawn.");
  if (status === "expired") return new ApiError(410, "invite_expired", "This invite has expired.");
  return null;
}

async function createWorkspace(ctx: Ctx): Promise<Reply> {
  const name = text(record(ctx.body).name).trim();
  if (!validName(name)) throw validation({ name: COPY.names });
  const id = newId();
  await tx(async (db) => {
    await db.query("INSERT INTO workspaces (id, name, owner_id) VALUES ($1,$2,$3)", [id, name, ctx.user.id]);
    await db.query("INSERT INTO memberships (workspace_id, user_id, role, joined_at) VALUES ($1,$2,'owner',$3)", [id, ctx.user.id, ctx.now]);
    await db.query("UPDATE users SET last_workspace_id = $2 WHERE id = $1", [ctx.user.id, id]);
    await logActivity(db, id, ctx.user.id, "workspace.created", name, ctx.now);
  });
  return { status: 201, json: { workspace: { id, name, role: "owner" } } };
}

async function memberList(db: Db, workspaceId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await db.query<{ user_id: string; display_name: string; email: string; role: string }>(
    "SELECT m.user_id, u.display_name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.joined_at, m.user_id",
    [workspaceId],
  );
  return rows.rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, email: r.email, role: r.role }));
}

async function getWorkspace(ctx: Ctx): Promise<Reply> {
  const role = await requireMember(ctx.params.wid, ctx.user);
  const workspace = await one<{ id: string; name: string }>(pool, "SELECT id, name FROM workspaces WHERE id = $1", [ctx.params.wid]);
  if (!workspace) throw notFound();
  await pool.query("UPDATE users SET last_workspace_id = $2 WHERE id = $1", [ctx.user.id, workspace.id]);
  let invites: Array<Record<string, unknown>> = [];
  if (role === "owner") {
    const rows = await pool.query<InviteRow>("SELECT * FROM invites WHERE workspace_id = $1 AND status = 'pending' AND expires_at > $2 ORDER BY created_at", [workspace.id, ctx.now]);
    invites = rows.rows.map((invite) => inviteJson(invite, ctx.now));
  }
  return { status: 200, json: { workspace: { id: workspace.id, name: workspace.name, role }, members: await memberList(pool, workspace.id), invites } };
}

async function changeRole(ctx: Ctx): Promise<Reply> {
  const wid = ctx.params.wid;
  requireRole(await requireMember(wid, ctx.user), OWNER_ONLY);
  const target = await one<{ role: Role; display_name: string; email: string }>(
    pool,
    "SELECT m.role, u.display_name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND m.user_id = $2",
    [wid, ctx.params.userId],
  );
  if (!target) throw notFound();
  if (target.role === "owner") throw new ApiError(409, "owner_role_fixed", "The owner's role cannot change.");
  const role = text(record(ctx.body).role);
  if (role !== "editor" && role !== "viewer") throw validation({ role: COPY.role });
  const workspace = (await one<{ name: string }>(pool, "SELECT name FROM workspaces WHERE id = $1", [wid]))?.name ?? "";
  if (role !== target.role) {
    const mailId = await tx(async (db) => {
      await db.query("UPDATE memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2", [wid, ctx.params.userId, role]);
      await logActivity(db, wid, ctx.user.id, "member.role_changed", target.display_name, ctx.now);
      const mail = roleMail(workspace, roleLabel(role));
      return enqueueMail(db, "role", target.email, mail.subject, mail.body, null);
    });
    if (role === "viewer") await releaseAllLeases(wid, ctx.params.userId);
    await deliverNow(mailId, target.email);
  }
  return { status: 200, json: { member: { userId: ctx.params.userId, displayName: target.display_name, email: target.email, role } } };
}

/** Demotion frees every lease the member holds, in every scene of the workspace. */
async function releaseAllLeases(workspaceId: string, userId: string): Promise<void> {
  const scenes = await pool.query<{ id: string }>("SELECT id FROM scenes WHERE workspace_id = $1", [workspaceId]);
  for (const scene of scenes.rows) await valkey.releaseWhere(scene.id, (lock) => lock.userId === userId).catch(() => undefined);
}

async function createInvite(ctx: Ctx): Promise<Reply> {
  const wid = ctx.params.wid;
  requireRole(await requireMember(wid, ctx.user), OWNER_ONLY);
  const body = record(ctx.body);
  const email = text(body.email).trim();
  const role = text(body.role);
  const fields: Record<string, string> = {};
  if (!EMAIL_PATTERN.test(email)) fields.email = COPY.email;
  else if (await one(pool, "SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.workspace_id = $1 AND u.email_key = $2", [wid, emailKey(email)])) {
    throw new ApiError(409, "already_member", "That person is already a member of this workspace.");
  }
  if (role !== "editor" && role !== "viewer") fields.role = COPY.role;
  if (Object.keys(fields).length > 0) throw validation(fields);
  const workspace = (await one<{ name: string }>(pool, "SELECT name FROM workspaces WHERE id = $1", [wid]))?.name ?? "";
  const key = emailKey(email);
  const id = newId();
  const token = newToken();
  const expiresAt = new Date(ctx.now.getTime() + config.inviteTtlSeconds * 1000);
  const { superseded, mailId } = await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`invite:${wid}:${key}`]);
    await db.query("UPDATE invites SET status = 'expired' WHERE workspace_id = $1 AND email_key = $2 AND status = 'pending' AND expires_at <= $3", [wid, key, ctx.now]);
    const old = await one<{ id: string }>(db, "UPDATE invites SET status = 'revoked', reason = 'superseded' WHERE workspace_id = $1 AND email_key = $2 AND status = 'pending' RETURNING id", [wid, key]);
    await db.query(
      "INSERT INTO invites (id, workspace_id, email, email_key, role, token, status, inviter_id, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9)",
      [id, wid, email, key, role, token, ctx.user.id, ctx.now, expiresAt],
    );
    await logActivity(db, wid, ctx.user.id, "invite.created", email, ctx.now);
    const mail = inviteMail(ctx.user.displayName, workspace, roleLabel(role), token, expiresAt);
    return { superseded: old?.id ?? null, mailId: await enqueueMail(db, "invite", email, mail.subject, mail.body, token) };
  });
  const delivery = await deliverNow(mailId, email);
  return { status: 201, json: { invite: { id, email, role, status: "pending", expiresAt: expiresAt.toISOString() }, delivery, superseded } };
}

async function revokeInvite(ctx: Ctx): Promise<Reply> {
  const wid = ctx.params.wid;
  requireRole(await requireMember(wid, ctx.user), OWNER_ONLY);
  const invite = await one<InviteRow>(pool, "SELECT * FROM invites WHERE id = $1 AND workspace_id = $2", [ctx.params.inviteId, wid]);
  if (!invite) throw notFound();
  const edge = illegalEdge(invite, ctx.now);
  if (edge) throw edge;
  const revoked = await tx(async (db) => {
    const row = await one<InviteRow>(db, "UPDATE invites SET status = 'revoked', reason = 'owner' WHERE id = $1 AND status = 'pending' RETURNING *", [invite.id]);
    if (row) await logActivity(db, wid, ctx.user.id, "invite.revoked", invite.email, ctx.now);
    return row;
  });
  if (!revoked) {
    const current = await one<InviteRow>(pool, "SELECT * FROM invites WHERE id = $1", [invite.id]);
    throw (current && illegalEdge(current, ctx.now)) || notFound();
  }
  return { status: 200, json: { invite: { ...inviteJson(revoked, ctx.now), reason: "owner" } } };
}

async function viewInvite(ctx: Ctx): Promise<Reply> {
  const invite = await one<InviteRow & { workspace_name: string }>(pool, "SELECT i.*, w.name AS workspace_name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = $1", [ctx.params.token]);
  if (!invite) throw notFound();
  if (invite.status === "revoked" && invite.reason === "superseded") throw new ApiError(410, "invite_superseded", "This invite was replaced by a newer one.");
  const status = effectiveStatus(invite, ctx.now);
  return {
    status: 200,
    json: { invite: { workspaceName: invite.workspace_name, email: invite.email, role: invite.role, status, reason: status === "revoked" ? invite.reason : null, expiresAt: invite.expires_at.toISOString() } },
  };
}

async function acceptInvite(ctx: Ctx): Promise<Reply> {
  const invite = await one<InviteRow>(pool, "SELECT * FROM invites WHERE token = $1", [ctx.params.token]);
  if (!invite) throw notFound();
  if (emailKey(ctx.user.email) !== invite.email_key) throw new ApiError(403, "invite_email_mismatch", `This invite is for ${invite.email}.`);
  const edge = illegalEdge(invite, ctx.now);
  if (edge) throw edge;
  const accepted = await tx(async (db) => {
    const row = await one<InviteRow>(db, "UPDATE invites SET status = 'accepted' WHERE id = $1 AND status = 'pending' AND expires_at > $2 RETURNING *", [invite.id, ctx.now]);
    if (!row) return null;
    await db.query("INSERT INTO memberships (workspace_id, user_id, role, joined_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [invite.workspace_id, ctx.user.id, invite.role, ctx.now]);
    await db.query("UPDATE users SET last_workspace_id = $2 WHERE id = $1", [ctx.user.id, invite.workspace_id]);
    await logActivity(db, invite.workspace_id, ctx.user.id, "invite.accepted", invite.email, ctx.now);
    return row;
  });
  if (!accepted) {
    const current = await one<InviteRow>(pool, "SELECT * FROM invites WHERE id = $1", [invite.id]);
    throw (current && illegalEdge(current, ctx.now)) || new ApiError(409, "invite_used", "This invite has already been used.");
  }
  return { status: 200, json: { workspaceId: invite.workspace_id, role: invite.role, landing: `/w/${invite.workspace_id}` } };
}

const ACTIVITY_DEFAULT = 50;
const ACTIVITY_MAX = 100;
const eventId = (seq: string): string => `e${seq.padStart(12, "0")}`;
const invalidCursor = (): ApiError => new ApiError(422, "invalid_cursor", "That page cursor is not valid for this log.");

async function listActivity(ctx: Ctx): Promise<Reply> {
  const wid = ctx.params.wid;
  await requireMember(wid, ctx.user);
  const rawLimit = ctx.query.get("limit");
  const limit = rawLimit === null ? ACTIVITY_DEFAULT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_MAX) throw invalidCursor();
  const before = ctx.query.get("before");
  let cursor: { at: Date; seq: string } | undefined;
  if (before !== null) {
    if (!/^e\d{12}$/.test(before)) throw invalidCursor();
    const found = await one<{ at: Date; seq: string }>(pool, "SELECT at, seq FROM activity WHERE workspace_id = $1 AND seq = $2", [wid, before.slice(1)]);
    if (!found) throw invalidCursor();
    cursor = found;
  }
  const rows = await pool.query<{ seq: string; at: Date; user_id: string; display_name: string; action: string; target_name: string }>(
    `SELECT a.seq, a.at, a.actor_id AS user_id, u.display_name, a.action, a.target_name FROM activity a JOIN users u ON u.id = a.actor_id
     WHERE a.workspace_id = $1 ${cursor ? "AND (a.at, a.seq) < ($3, $4)" : ""} ORDER BY a.at DESC, a.seq DESC LIMIT $2`,
    cursor ? [wid, limit + 1, cursor.at, cursor.seq] : [wid, limit + 1],
  );
  const page = rows.rows.slice(0, limit);
  const events = page.map((r) => ({ id: eventId(r.seq), at: r.at.toISOString(), actor: { userId: r.user_id, displayName: r.display_name }, action: r.action, targetName: r.target_name }));
  return { status: 200, json: { events, nextBefore: rows.rows.length > limit && events.length > 0 ? events[events.length - 1].id : null } };
}

interface ProjectRow {
  id: string;
  name: string;
  updated_at: Date;
  scene_count: string;
  asset_count: string;
}
const projectJson = (p: ProjectRow): Record<string, unknown> => ({ id: p.id, name: p.name, sceneCount: Number(p.scene_count), assetCount: Number(p.asset_count), updatedAt: p.updated_at.toISOString() });
const PROJECT_SQL = `SELECT p.id, p.name, p.updated_at, (SELECT count(*) FROM scenes s WHERE s.project_id = p.id) AS scene_count,
  (SELECT count(*) FROM assets a WHERE a.project_id = p.id) AS asset_count FROM projects p`;

export async function loadProject(db: Db, id: string): Promise<Record<string, unknown>> {
  const row = await one<ProjectRow>(db, `${PROJECT_SQL} WHERE p.id = $1`, [id]);
  if (!row) throw notFound();
  return projectJson(row);
}

async function listProjects(ctx: Ctx): Promise<Reply> {
  await requireMember(ctx.params.wid, ctx.user);
  const rows = await pool.query<ProjectRow>(`${PROJECT_SQL} WHERE p.workspace_id = $1 ORDER BY p.created_at, p.id`, [ctx.params.wid]);
  return { status: 200, json: { projects: rows.rows.map(projectJson) } };
}

async function createProject(ctx: Ctx): Promise<Reply> {
  const wid = ctx.params.wid;
  requireRole(await requireMember(wid, ctx.user), CAN_EDIT);
  const name = text(record(ctx.body).name).trim();
  if (!validName(name)) throw validation({ name: COPY.names });
  const id = newId();
  await tx(async (db) => {
    await db.query("INSERT INTO projects (id, workspace_id, name, created_at, updated_at) VALUES ($1,$2,$3,$4,$4)", [id, wid, name, ctx.now]);
    await logActivity(db, wid, ctx.user.id, "project.created", name, ctx.now);
  });
  return { status: 201, json: { project: await loadProject(pool, id) } };
}

export function registerWorkspaceRoutes(): void {
  route("POST", "/api/workspaces", createWorkspace);
  route("GET", "/api/workspaces/:wid", getWorkspace);
  route("PATCH", "/api/workspaces/:wid/members/:userId", changeRole);
  route("POST", "/api/workspaces/:wid/invites", createInvite);
  route("DELETE", "/api/workspaces/:wid/invites/:inviteId", revokeInvite);
  route("GET", "/api/invites/:token", viewInvite, { public: true });
  route("POST", "/api/invites/:token/accept", acceptInvite);
  route("GET", "/api/workspaces/:wid/activity", listActivity);
  route("GET", "/api/workspaces/:wid/projects", listProjects);
  route("POST", "/api/workspaces/:wid/projects", createProject);
}
