import { randomBytes } from "node:crypto";
import { ApiError, invalid, notFound } from "../shared/errors.js";
import { EMAIL, notice } from "../shared/notices.js";
import type { Member, Role } from "../shared/types.js";
import { memberRole, requireOwner, roleIn, workspaceOf } from "./access.js";
import { tokenHash, type User } from "./auth.js";
import { config } from "./config.js";
import { all, newId, one, pool, transaction } from "./db.js";
import { memberRemoved, roleChanged } from "./live.js";
import { sendMail } from "./mail.js";
import { loadDoc } from "./workspaces.js";

export async function listMembers(user: User, workspaceId: string): Promise<Member[]> {
  await memberRole(user, workspaceId);
  const active = await all<{ user_id: string; email: string; name: string; role: Role }>(
    pool,
    "SELECT m.user_id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.role = 'owner' DESC, m.joined_at",
    [workspaceId],
  );
  const invited = await all<{ id: string; email: string; role: Role }>(pool, "SELECT id, email, role FROM invitations WHERE workspace_id = $1 AND status = 'pending' ORDER BY created_at", [workspaceId]);
  return [
    ...active.map((m) => ({ userId: m.user_id, email: m.email, name: m.name, role: m.role, status: "active" as const })),
    ...invited.map((i) => ({ inviteId: i.id, email: i.email, role: i.role, status: "invited" as const })),
  ];
}

const alreadyInvited = (email: string) => new ApiError(409, "already_invited", notice.alreadyInvited(email));

function article(role: "editor" | "viewer"): string {
  return role === "editor" ? "an editor" : "a viewer";
}

/** Invite by email: the row commits only once SMTP accepted the mail, and the pending index holds a concurrent invite until then. */
export async function invite(user: User, workspaceId: string, body: Record<string, unknown>): Promise<Member> {
  requireOwner(await memberRole(user, workspaceId));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role;
  const already = await one<{ n: number }>(pool, "SELECT 1 AS n FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND u.email = $2", [workspaceId, email]);
  if (email && already) throw new ApiError(409, "already_member", notice.alreadyMember(email));
  const pending = await one(pool, "SELECT 1 FROM invitations WHERE workspace_id = $1 AND email = $2 AND status = 'pending'", [workspaceId, email]);
  if (email && pending) throw alreadyInvited(email);
  const problems: Record<string, string> = {};
  if (!EMAIL.test(email)) problems.email = "Enter an email address like name@example.org.";
  if (role !== "editor" && role !== "viewer") problems.role = "A role is editor or viewer.";
  if (Object.keys(problems).length) throw invalid(problems);
  const doc = await loadDoc(workspaceId);
  const token = randomBytes(32).toString("base64url");
  const as = article(role as "editor" | "viewer");
  const id = newId("inv");
  await transaction(async (client) => {
    const claimed = await one(
      client,
      "INSERT INTO invitations (id, workspace_id, email, role, token_hash, status, invited_by) VALUES ($1, $2, $3, $4, $5, 'pending', $6) ON CONFLICT DO NOTHING RETURNING id",
      [id, workspaceId, email, role, tokenHash(token), user.id],
    );
    if (!claimed) throw alreadyInvited(email);
    try {
      await sendMail({
        to: email,
        subject: `${user.name} invited you to ${doc.name} as ${as}`,
        text: `${user.name} invited you to edit the ${doc.name} workspace in Plinth as ${as} (role: ${role}).\n\nOpen this link to accept. It works once, for this address only:\n${config.publicUrl}/invites/${token}\n`,
      });
    } catch {
      throw new ApiError(503, "mail_unavailable", notice.inviteFailed);
    }
  });
  return { inviteId: id, email, role: role as Role, status: "invited" };
}

export async function revokeInvite(user: User, inviteId: string): Promise<void> {
  const workspaceId = await workspaceOf("invitation", inviteId);
  requireOwner(await memberRole(user, workspaceId));
  const updated = await one(pool, "UPDATE invitations SET status = 'revoked' WHERE id = $1 AND status = 'pending' RETURNING id", [inviteId]);
  if (!updated) throw new ApiError(409, "not_pending", "This invitation is no longer pending.");
}

const inviteInvalid = () => new ApiError(404, "invite_invalid", "This invitation isn't valid.");

/** Accept an invitation: valid once, only for its email and role. */
export async function acceptInvite(user: User, token: string): Promise<{ workspaceId: string; role: Role; redirect: string }> {
  return transaction(async (tx) => {
    const row = await one<{ id: string; workspace_id: string; email: string; role: Role }>(
      tx,
      "SELECT id, workspace_id, email, role FROM invitations WHERE token_hash = $1 AND status = 'pending' FOR UPDATE",
      [tokenHash(token)],
    );
    if (!row || row.email !== user.email.toLowerCase() || (await roleIn(row.workspace_id, user.id, tx))) throw inviteInvalid();
    await tx.query("UPDATE invitations SET status = 'accepted' WHERE id = $1", [row.id]);
    await tx.query("INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, $3)", [row.workspace_id, user.id, row.role]);
    const doc = await loadDoc(row.workspace_id, tx);
    const first = [...doc.pages].sort((a, b) => a.order - b.order)[0];
    return { workspaceId: row.workspace_id, role: row.role, redirect: `/w/${row.workspace_id}/edit?page=${first.id}` };
  });
}

async function targetMember(user: User, workspaceId: string, userId: string): Promise<Role> {
  requireOwner(await memberRole(user, workspaceId));
  const role = await roleIn(workspaceId, userId);
  if (!role) throw notFound();
  if (role === "owner") throw new ApiError(409, "owner_role_fixed", "The owner's role cannot change.");
  return role;
}

export async function changeRole(user: User, workspaceId: string, userId: string, body: Record<string, unknown>): Promise<Member> {
  await targetMember(user, workspaceId, userId);
  if (body.role !== "editor" && body.role !== "viewer") throw invalid({ role: "A role is editor or viewer." });
  await pool.query("UPDATE members SET role = $3 WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId, body.role]);
  roleChanged(workspaceId, userId, body.role);
  const member = await one<{ email: string; name: string }>(pool, "SELECT email, name FROM users WHERE id = $1", [userId]);
  return { userId, email: member?.email ?? "", name: member?.name ?? "", role: body.role, status: "active" };
}

export async function removeMember(user: User, workspaceId: string, userId: string): Promise<void> {
  await targetMember(user, workspaceId, userId);
  await pool.query("DELETE FROM members WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]);
  memberRemoved(workspaceId, userId);
}
