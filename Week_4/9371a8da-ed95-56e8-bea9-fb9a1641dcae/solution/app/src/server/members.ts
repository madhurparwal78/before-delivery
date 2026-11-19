// Memberships, the invite state machine, the hourly invite allowance and share links.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { Invite, InviteRole, InviteStatus, Member, Role, ShareLink } from "../shared/api.ts";
import { membership, personShape, requireRole, userShape, type PersonRow } from "./access.ts";
import { createUser, digest, endSession, openSession, passwordMatches, sessionCookie, signedIn, SESSION_COOKIE, userByEmail } from "./auth.ts";
import { config } from "./config.ts";
import { one, pool, query, transaction, turn, type Db } from "./db.ts";
import { fail, noContent, ok, type Context, type Reply } from "./http.ts";
import { sendInvite } from "./mail.ts";
import { newId } from "./projects.ts";
import { Fields, normalEmail, onlyKeys, unstorable, validDisplayName, validEmail } from "./validate.ts";

const ROLES: readonly Role[] = ["owner", "editor", "reviewer", "viewer"];
const INVITE_ROLES: readonly InviteRole[] = ["editor", "reviewer", "viewer"];
const HOURLY_INVITES = 10;

interface MemberRow extends PersonRow {
  role: Role;
}

async function memberRows(db: Db, projectId: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    db,
    `SELECT u.id, u.email, u.display_name, u.handle, m.role FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = $1
      ORDER BY array_position(ARRAY['owner','editor','reviewer','viewer'], m.role), u.display_name`,
    [projectId],
  );
}

/** Owners see member emails; everyone else sees ID, display name and handle only. */
function memberShape(row: MemberRow, callerRole: Role): Member {
  return { user: callerRole === "owner" ? userShape(row) : personShape(row), role: row.role };
}

export async function readMembers(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const { project, role } = await membership(pool, user.id, ctx.params.pid ?? "");
  return ok({ members: (await memberRows(pool, project.id)).map((row) => memberShape(row, role)) });
}

/** Role changes and removals take one turn per project; a caller who stopped being an owner meanwhile changes nothing. */
async function changeMembership(
  ctx: Context,
  change: (client: pg.PoolClient, target: MemberRow, members: MemberRow[]) => Promise<Reply>,
): Promise<Reply> {
  const user = await signedIn(ctx);
  const [access, exists] = await Promise.all([
    membership(pool, user.id, ctx.params.pid ?? ""),
    one(pool, "SELECT 1 FROM memberships WHERE project_id = $1 AND user_id = $2", [ctx.params.pid, ctx.params.uid]),
  ]);
  const projectId = access.project.id;
  if (!exists) throw fail.notFound();
  requireRole(access, "own");
  return transaction(async (client) => {
    await turn(client, "members", projectId);
    const rows = await memberRows(client, projectId);
    const caller = rows.find((row) => row.id === user.id);
    const target = rows.find((row) => row.id === ctx.params.uid);
    if (!target) throw fail.notFound();
    if (caller?.role !== "owner") throw fail.conflict("last_owner");
    return change(client, target, rows);
  });
}

function ownersLeft(rows: MemberRow[], target: MemberRow): boolean {
  return target.role !== "owner" || rows.filter((row) => row.role === "owner").length > 1;
}

export function updateMember(ctx: Context): Promise<Reply> {
  return changeMembership(ctx, async (client, target, members) => {
    if (ctx.body.role !== "owner" && !ownersLeft(members, target)) throw fail.conflict("last_owner");
    const fields = new Fields(ctx.body, ["role"]);
    const chosen = fields.oneOf("role", ROLES, "Choose owner, editor, reviewer or viewer.");
    fields.check();
    await client.query("UPDATE memberships SET role = $3 WHERE project_id = $1 AND user_id = $2", [ctx.params.pid, target.id, chosen]);
    return ok({ member: memberShape({ ...target, role: chosen }, "owner") });
  });
}

export function removeMember(ctx: Context): Promise<Reply> {
  return changeMembership(ctx, async (client, target, members) => {
    if (!ownersLeft(members, target)) throw fail.conflict("last_owner");
    await client.query("DELETE FROM memberships WHERE project_id = $1 AND user_id = $2", [ctx.params.pid, target.id]);
    return noContent();
  });
}

interface InviteRow {
  id: string;
  project_id: string;
  email: string;
  email_key: string;
  role: InviteRole;
  status: "pending" | "accepted" | "revoked";
  sent_at: Date;
  expires_at: Date;
  inviter_id: string;
}

/** The invite state machine: a pending invite reads as expired from its expiry instant, judged in UTC now. */
function inviteStatus(row: InviteRow): InviteStatus {
  return row.status === "pending" && Date.now() >= row.expires_at.getTime() ? "expired" : row.status;
}

function inviteShape(row: InviteRow): Invite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: inviteStatus(row),
    sentAt: row.sent_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

export async function readInvites(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  requireRole(access, "own");
  const rows = await query<InviteRow>(pool, "SELECT * FROM invites WHERE project_id = $1 ORDER BY sent_at DESC, id", [access.project.id]);
  return ok({ invites: rows.map(inviteShape) });
}

/** The hourly allowance: seconds until the oldest counted invite leaves the window, or 0 when one more fits. */
async function allowanceWait(client: pg.PoolClient, projectId: string, now: Date): Promise<number> {
  const counted = await client.query<{ count: number; oldest: Date | null }>(
    "SELECT count(*)::int AS count, min(sent_at) AS oldest FROM invites WHERE project_id = $1 AND sent_at > $2",
    [projectId, new Date(now.getTime() - config.inviteWindowSeconds * 1000)],
  );
  const { count, oldest } = counted.rows[0] ?? { count: 0, oldest: null };
  if (count < HOURLY_INVITES || !oldest) return 0;
  return Math.max(1, Math.ceil((oldest.getTime() + config.inviteWindowSeconds * 1000 - now.getTime()) / 1000));
}

export async function createInvite(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  requireRole(access, "own");
  const projectId = access.project.id;
  return transaction(async (client) => {
    await turn(client, "invites", projectId);
    const email = typeof ctx.body.email === "string" && !unstorable(ctx.body.email) ? normalEmail(ctx.body.email) : "";
    if (email) {
      const member = await client.query(
        "SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 AND u.email_key = $2",
        [projectId, email],
      );
      if (member.rowCount) throw fail.conflict("already_member");
      const pending = await client.query(
        "SELECT 1 FROM invites WHERE project_id = $1 AND email_key = $2 AND status = 'pending' AND expires_at > $3",
        [projectId, email, new Date()],
      );
      if (pending.rowCount) throw fail.conflict("invite_pending");
    }
    const fields = new Fields(ctx.body, ["email", "role"]);
    const address = fields.string("email", "Enter a valid email address.", validEmail).trim();
    const role = fields.oneOf("role", INVITE_ROLES, "Choose editor, reviewer or viewer.");
    fields.check();
    const sentAt = new Date();
    const wait = await allowanceWait(client, projectId, sentAt);
    if (wait > 0) throw fail.rateLimited(wait);
    const expiresAt = new Date(sentAt.getTime() + config.inviteTtlSeconds * 1000);
    const token = randomBytes(32).toString("base64url");
    await sendInvite({
      to: address,
      inviterName: user.display_name,
      projectTitle: access.project.title,
      role,
      token,
      expiresAt: expiresAt.toISOString(),
    });
    const row = await client.query<InviteRow>(
      `INSERT INTO invites (id, project_id, email, email_key, role, token_hash, status, sent_at, expires_at, inviter_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9) RETURNING *`,
      [newId(), projectId, address, normalEmail(address), role, digest(token), sentAt, expiresAt, user.id],
    );
    return ok({ invite: inviteShape(row.rows[0] as InviteRow) }, 201);
  });
}

export async function revokeInvite(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  const exists = await one(pool, "SELECT 1 FROM invites WHERE project_id = $1 AND id = $2", [access.project.id, ctx.params.iid]);
  if (!exists) throw fail.notFound();
  requireRole(access, "own");
  return transaction(async (client) => {
    const row = await client.query<InviteRow>("SELECT * FROM invites WHERE id = $1 FOR UPDATE", [ctx.params.iid]);
    const invite = row.rows[0] as InviteRow;
    if (inviteStatus(invite) !== "pending") throw fail.conflict("invite_not_pending");
    onlyKeys(ctx.body, []);
    const updated = await client.query<InviteRow>("UPDATE invites SET status = 'revoked' WHERE id = $1 RETURNING *", [invite.id]);
    return ok({ invite: inviteShape(updated.rows[0] as InviteRow) });
  });
}

async function inviteByToken(db: Db, token: string, lock = false): Promise<InviteRow & { title: string; inviter_name: string }> {
  const row = await one<InviteRow & { title: string; inviter_name: string }>(
    db,
    `SELECT i.*, p.title, u.display_name AS inviter_name FROM invites i
       JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = i.inviter_id
      WHERE i.token_hash = $1 ${lock ? "FOR UPDATE OF i" : ""}`,
    [digest(token)],
  );
  if (!row) throw fail.notFound();
  return row;
}

export async function readInvite(ctx: Context): Promise<Reply> {
  const invite = await inviteByToken(pool, ctx.params.token ?? "");
  const status = inviteStatus(invite);
  if (status !== "pending") throw fail.gone(status);
  return ok({
    invite: {
      projectTitle: invite.title,
      role: invite.role,
      inviterName: invite.inviter_name,
      email: invite.email,
      expiresAt: invite.expires_at.toISOString(),
    },
  });
}

export async function acceptInvite(ctx: Context): Promise<Reply> {
  await inviteByToken(pool, ctx.params.token ?? "");
  const { user, projectId, role, token } = await transaction(async (client) => {
    const invite = await inviteByToken(client, ctx.params.token ?? "", true);
    const existing = await userByEmail(client, invite.email);
    const typed = ctx.body.password;
    if (existing && typeof typed === "string" && !(await passwordMatches(typed, existing.password_hash))) throw fail.invalidCredentials();
    const status = inviteStatus(invite);
    if (status !== "pending") throw fail.gone(status);
    if (existing) {
      const member = await client.query("SELECT 1 FROM memberships WHERE project_id = $1 AND user_id = $2", [invite.project_id, existing.id]);
      if (member.rowCount) throw fail.conflict("already_member", { projectId: invite.project_id });
    }
    const fields = new Fields(ctx.body, ["displayName", "password"]);
    const password = fields.string("password", "Use at least 10 characters.", (value) => existing !== undefined || value.length >= 10);
    const displayName = existing
      ? existing.display_name
      : fields.string("displayName", "Enter a display name of 1 to 80 characters.", validDisplayName);
    fields.check();
    const person = existing ?? (await createUser(client, invite.email, displayName, password));
    await client.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, $3)", [invite.project_id, person.id, invite.role]);
    await client.query("UPDATE invites SET status = 'accepted' WHERE id = $1", [invite.id]);
    await endSession(client, ctx.cookies[SESSION_COOKIE]);
    return { user: person, projectId: invite.project_id, role: invite.role, token: await openSession(client, person.id) };
  });
  return ok({ user: userShape(user), projectId, role }, 200, { "Set-Cookie": sessionCookie(token) });
}

function shareShape(row: { token: string; created_at: Date; expires_at: Date }): ShareLink {
  return {
    token: row.token,
    url: `${config.appBaseUrl}/s/${row.token}`,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    active: Date.now() < row.expires_at.getTime(),
  };
}

async function ownerAccess(ctx: Context): Promise<string> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  requireRole(access, "own");
  return access.project.id;
}

export async function readShareLink(ctx: Context): Promise<Reply> {
  const projectId = await ownerAccess(ctx);
  const row = await one<{ token: string; created_at: Date; expires_at: Date }>(pool, "SELECT * FROM share_links WHERE project_id = $1", [projectId]);
  return ok({ shareLink: row ? shareShape(row) : null });
}

/** Creates the link, or regenerates it: a new token with a fresh lifetime, the old one dead at once. */
export async function issueShareLink(ctx: Context): Promise<Reply> {
  const projectId = await ownerAccess(ctx);
  onlyKeys(ctx.body, []);
  const createdAt = new Date();
  const row = await one<{ token: string; created_at: Date; expires_at: Date }>(
    pool,
    `INSERT INTO share_links (project_id, token, created_at, expires_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id) DO UPDATE SET token = $2, created_at = $3, expires_at = $4 RETURNING *`,
    [projectId, randomBytes(32).toString("base64url"), createdAt, new Date(createdAt.getTime() + config.shareLinkTtlSeconds * 1000)],
  );
  return ok({ shareLink: shareShape(row as { token: string; created_at: Date; expires_at: Date }) }, 201);
}

export async function revokeShareLink(ctx: Context): Promise<Reply> {
  const projectId = await ownerAccess(ctx);
  await query(pool, "DELETE FROM share_links WHERE project_id = $1", [projectId]);
  return noContent();
}
