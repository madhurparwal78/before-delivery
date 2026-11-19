// Members, roles and invites (brief: Roles and invites, Services Mailpit). Invite expiry is judged
// on the server clock at every read and acceptance through `inviteStatus`.
import { copy } from "../shared/copy";
import { ApiError, requireFields } from "../shared/errors";
import { inviteExpiresAt, inviteStatus, isInvitableRole, isInviteClosed, isInviteOpen, isOwner, type StoredInviteStatus } from "../shared/rules";
import { emailError, normaliseEmail } from "../shared/text";
import type { InviteView, MemberView, Role, UserView } from "../shared/types";
import { diagramAccess, requireRole, type Access } from "./access";
import { requireUser } from "./auth";
import { config } from "./config";
import { isUniqueViolation, one, pool, transaction, type Queryable } from "./db";
import { json, objectBody, route, type Request } from "./http";
import { newId } from "./ids";
import { broadcast, closeMember, roleChanged } from "./live";
import { diagramLink, sendMail } from "./mail";

interface InviteRow {
  id: string;
  email: string;
  role: "editor" | "viewer";
  status: StoredInviteStatus;
  sent_at: Date;
  diagram_id: string;
}

function statusOf(row: InviteRow): StoredInviteStatus | "expired" {
  return inviteStatus(row.status, row.sent_at.getTime(), Date.now(), config.inviteTtlMs);
}

/** An invite as listed: only open and expired invites are ever shown. */
function inviteView(row: InviteRow & { status: "emailed" | "email_not_sent" }): InviteView {
  const status = inviteStatus(row.status, row.sent_at.getTime(), Date.now(), config.inviteTtlMs);
  return { id: row.id, email: row.email, role: row.role, status, expiresAt: inviteExpiresAt(row.sent_at.getTime(), config.inviteTtlMs) };
}

/** An open invite for this email becomes an active membership on sign-up or sign-in. */
export async function acceptOpenInvites(db: Queryable, user: UserView): Promise<void> {
  const { rows } = await db.query<InviteRow>("SELECT * FROM invites WHERE email = $1 AND status IN ('emailed', 'email_not_sent') FOR UPDATE", [normaliseEmail(user.email)]);
  for (const row of rows) {
    if (!isInviteOpen(statusOf(row))) continue;
    await db.query("UPDATE invites SET status = 'accepted' WHERE id = $1", [row.id]);
    await db.query("INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [row.diagram_id, user.id, row.role]);
  }
}

async function ownerAccess(req: Request): Promise<Access> {
  const user = await requireUser(req);
  const access = await diagramAccess(user, req.params[0] as string);
  requireRole(access, isOwner);
  return access;
}

async function findInvite(diagramId: string, inviteId: string): Promise<InviteRow> {
  const { rows } = await pool.query<InviteRow>("SELECT * FROM invites WHERE id = $1 AND diagram_id = $2", [inviteId, diagramId]);
  const row = rows[0];
  if (!row) throw new ApiError("not_found");
  return row;
}

/** Sends the invite email and records whether the mail server accepted it. */
async function deliver(access: Access, row: InviteRow): Promise<InviteRow & { status: "emailed" | "email_not_sent" }> {
  const sentAt = new Date();
  const text = [
    `${access.user.name} invited you to the diagram "${access.title}" on Linewell as ${row.role === "editor" ? "an editor" : "a viewer"}.`,
    "",
    `Open it here: ${diagramLink(access.diagramId)}`,
    "",
    `Sign in or create an account with ${row.email} to join.`,
  ].join("\n");
  const ok = await sendMail(row.email, copy.inviteSubject(access.user.name, access.title, row.role), text);
  const status = ok ? "emailed" : "email_not_sent";
  await pool.query("UPDATE invites SET status = $2, sent_at = $3 WHERE id = $1", [row.id, status, sentAt]);
  broadcast(access.diagramId, { type: "members" });
  return { ...row, status, sent_at: sentAt };
}

route("GET", "/api/diagrams/:id/members", async (req) => {
  const user = await requireUser(req);
  const access = await diagramAccess(user, req.params[0] as string);
  const members = await pool.query<{ user_id: string; email: string; name: string; role: Role }>(
    `SELECT m.user_id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.diagram_id = $1 ORDER BY (m.role = 'owner') DESC, u.name`, [access.diagramId]);
  const invites = await pool.query<InviteRow & { status: "emailed" | "email_not_sent" }>(
    "SELECT * FROM invites WHERE diagram_id = $1 AND status IN ('emailed', 'email_not_sent') ORDER BY sent_at", [access.diagramId]);
  return json(200, {
    members: members.rows.map((m): MemberView => ({ userId: m.user_id, email: m.email, name: m.name, role: m.role, status: "active" })),
    invites: invites.rows.map(inviteView),
  });
});

route("POST", "/api/diagrams/:id/invites", async (req) => {
  const access = await ownerAccess(req);
  const { email, role } = objectBody(req.body);
  if (emailError(email) === null) {
    const address = normaliseEmail(email as string);
    const member = await pool.query("SELECT 1 FROM members m JOIN users u ON u.id = m.user_id WHERE m.diagram_id = $1 AND u.email = $2", [access.diagramId, address]);
    if (member.rowCount) throw new ApiError("already_member");
    const existing = await pool.query<InviteRow>("SELECT * FROM invites WHERE diagram_id = $1 AND email = $2 AND status IN ('emailed', 'email_not_sent')", [access.diagramId, address]);
    if (existing.rows.some((row) => isInviteOpen(statusOf(row)))) throw new ApiError("already_invited");
  }
  requireFields({ email: emailError(email), role: isInvitableRole(role) ? null : "Choose Editor or Viewer." });
  if (typeof email !== "string" || !isInvitableRole(role)) throw new ApiError("invalid");
  const address = normaliseEmail(email);
  const row: InviteRow = { id: newId("i_"), email: address, role, status: "email_not_sent", sent_at: new Date(), diagram_id: access.diagramId };
  try {
    await transaction(async (db) => {
      await db.query("UPDATE invites SET status = 'revoked' WHERE diagram_id = $1 AND email = $2 AND status IN ('emailed', 'email_not_sent')", [access.diagramId, address]);
      await db.query("INSERT INTO invites (id, diagram_id, email, role, status, inviter_id, sent_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [row.id, row.diagram_id, row.email, row.role, row.status, access.user.id, row.sent_at]);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError("already_invited");
    throw error;
  }
  return json(201, { invite: inviteView(await deliver(access, row)) });
});

route("POST", "/api/diagrams/:id/invites/:invite/resend", async (req) => {
  const access = await ownerAccess(req);
  const row = await findInvite(access.diagramId, req.params[1] as string);
  if (isInviteClosed(statusOf(row))) throw new ApiError("invite_closed");
  return json(200, { invite: inviteView(await deliver(access, row)) });
});

route("DELETE", "/api/diagrams/:id/invites/:invite", async (req) => {
  const access = await ownerAccess(req);
  const row = await findInvite(access.diagramId, req.params[1] as string);
  if (isInviteClosed(statusOf(row))) throw new ApiError("invite_closed");
  await pool.query("UPDATE invites SET status = 'revoked' WHERE id = $1", [row.id]);
  broadcast(access.diagramId, { type: "members" });
  return { status: 204 };
});

async function targetMember(access: Access, userId: string): Promise<Role> {
  const { rows } = await pool.query<{ role: Role }>("SELECT role FROM members WHERE diagram_id = $1 AND user_id = $2", [access.diagramId, userId]);
  const row = rows[0];
  if (!row) throw new ApiError("not_found");
  return row.role;
}

route("PATCH", "/api/diagrams/:id/members/:user", async (req) => {
  const access = await ownerAccess(req);
  const userId = req.params[1] as string;
  const current = await targetMember(access, userId);
  if (current === "owner") throw new ApiError("owner_role");
  const { role } = objectBody(req.body);
  requireFields({ role: isInvitableRole(role) ? null : "Choose Editor or Viewer." });
  if (!isInvitableRole(role)) throw new ApiError("invalid");
  await pool.query("UPDATE members SET role = $3 WHERE diagram_id = $1 AND user_id = $2", [access.diagramId, userId, role]);
  const user = one((await pool.query<{ email: string; name: string }>("SELECT email, name FROM users WHERE id = $1", [userId])).rows);
  roleChanged(access.diagramId, userId, role);
  broadcast(access.diagramId, { type: "members" });
  const member: MemberView = { userId, email: user.email, name: user.name, role, status: "active" };
  return json(200, { member });
});

route("DELETE", "/api/diagrams/:id/members/:user", async (req) => {
  const access = await ownerAccess(req);
  const userId = req.params[1] as string;
  if ((await targetMember(access, userId)) === "owner") throw new ApiError("owner_role");
  await pool.query("DELETE FROM members WHERE diagram_id = $1 AND user_id = $2", [access.diagramId, userId]);
  closeMember(access.diagramId, userId);
  broadcast(access.diagramId, { type: "members" });
  return { status: 204 };
});
