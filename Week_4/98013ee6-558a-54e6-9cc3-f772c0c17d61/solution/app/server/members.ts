import { randomBytes } from "node:crypto";
import { authorize, loadBoard } from "./access.js";
import { config } from "./config.js";
import { now, iso } from "./clock.js";
import { lockBoards } from "./containers.js";
import { Body, type SessionUser } from "./http.js";
import { exactlyOne, one, pool, rows, tx } from "./db.js";
import { conflict, forbidden, gone, notFound, validation } from "./errors.js";
import { emit } from "./events.js";
import { sendMailInBackground } from "./mail.js";
import { dropPresence, emitViewers } from "./presence.js";
import { roleLabel } from "../shared/roles.js";
import { isEmail, normalizeEmail } from "./text.js";
import type { InviteInfo, InviteRow, MemberRole, Members, UserRef } from "../shared/types.js";

function memberRole(value: unknown): MemberRole {
  if (value !== "editor" && value !== "viewer") throw validation("role");
  return value;
}

export async function listMembers(viewerId: number, boardId: number): Promise<Members> {
  const access = await loadBoard(pool, boardId, viewerId);
  const owner = await one<UserRef>(pool, "SELECT id, name, handle FROM users WHERE id = $1", [access.ownerId]);
  const members = await rows<{ id: number; name: string; handle: string; role: MemberRole }>(
    pool,
    "SELECT u.id, u.name, u.handle, m.role FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = $1 ORDER BY u.id",
    [boardId],
  );
  const invites =
    access.role === "owner"
      ? await rows<{ id: number; email: string; role: MemberRole; expires_at: Date }>(
          pool,
          "SELECT id, email, role, expires_at FROM invites WHERE board_id = $1 AND status = 'pending' AND expires_at > $2 ORDER BY id",
          [boardId, now()],
        )
      : [];
  return {
    owner: owner ?? { id: access.ownerId, name: "", handle: "" },
    members: members.map((member) => ({ user: { id: member.id, name: member.name, handle: member.handle }, role: member.role })),
    invites: invites.map((invite): InviteRow => ({ id: invite.id, email: invite.email, role: invite.role, expires_at: iso(invite.expires_at) })),
  };
}

export async function changeRole(me: SessionUser, boardId: number, userId: number, roleValue: unknown): Promise<{ user: UserRef; role: MemberRole }> {
  return tx(async (client) => {
    const access = await loadBoard(client, boardId, me.id, true);
    authorize(access, "manage_members");
    const member = await one<UserRef>(
      client,
      "SELECT u.id, u.name, u.handle FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = $1 AND m.user_id = $2",
      [boardId, userId],
    );
    if (!member) throw notFound();
    const role = memberRole(roleValue);
    await client.query("UPDATE board_members SET role = $3 WHERE board_id = $1 AND user_id = $2", [boardId, userId, role]);
    await emit(client, { kind: "person", user: userId }, { type: "membership", board_id: boardId, role });
    return { user: member, role };
  });
}

export async function removeMember(me: SessionUser, boardId: number, userId: number): Promise<void> {
  await tx(async (client) => {
    const access = await loadBoard(client, boardId, me.id, true);
    const isMember = (await one(client, "SELECT 1 FROM board_members WHERE board_id = $1 AND user_id = $2", [boardId, userId])) !== null;
    if (access.role === "owner") {
      if (!isMember) throw notFound();
    } else {
      authorize(access, "leave");
      if (userId !== me.id) throw forbidden();
    }
    await client.query("DELETE FROM board_members WHERE board_id = $1 AND user_id = $2", [boardId, userId]);
    await dropPresence(client, boardId, userId);
    await emit(client, { kind: "person", user: userId }, { type: "membership", board_id: boardId, role: null });
    await emitViewers(client, boardId);
  });
}

export async function inviteToBoard(me: SessionUser, boardId: number, body: Body): Promise<{ status: "sent"; email: string }> {
  const sent = await tx(async (client) => {
    const access = await loadBoard(client, boardId, me.id, true);
    authorize(access, "manage_members");
    const raw = body.get("email");
    const email = typeof raw === "string" ? raw.trim() : "";
    const already = await one(
      client,
      `SELECT 1 FROM users u WHERE lower(u.email) = $2
          AND (u.id = $3 OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = $1 AND m.user_id = u.id))`,
      [boardId, normalizeEmail(email), access.ownerId],
    );
    if (already) throw conflict("already_member");
    if (!isEmail(normalizeEmail(email))) throw validation("email");
    const role = memberRole(body.get("role"));
    await client.query("UPDATE invites SET status = 'revoked' WHERE board_id = $1 AND lower(email) = $2 AND status = 'pending'", [boardId, normalizeEmail(email)]);
    const token = randomBytes(24).toString("base64url");
    const at = now();
    await client.query(
      "INSERT INTO invites (board_id, inviter_id, email, role, token, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [boardId, me.id, email, role, token, at, new Date(at.getTime() + config.inviteTtlSeconds * 1000)],
    );
    return { email, role, token, boardName: access.name };
  });
  sendMailInBackground(
    sent.email,
    `${me.name} invited you to ${sent.boardName}`,
    `${me.name} invited you to the board "${sent.boardName}" on Mothlight.\n\nRole: ${roleLabel(sent.role)}\n\nJoin: ${config.publicUrl}/invites/${sent.token}\n`,
  );
  return { status: "sent", email: sent.email };
}

export async function withdrawInvite(me: SessionUser, inviteId: number): Promise<void> {
  await tx(async (client) => {
    const invite = await one<{ board_id: number; status: string }>(client, "SELECT board_id, status FROM invites WHERE id = $1 FOR UPDATE", [inviteId]);
    if (!invite) throw notFound();
    const access = await loadBoard(client, invite.board_id, me.id);
    authorize(access, "manage_members");
    if (invite.status !== "pending") throw conflict("invite_not_pending");
    await client.query("UPDATE invites SET status = 'revoked' WHERE id = $1", [inviteId]);
  });
}

interface InviteRecord {
  id: number;
  board_id: number;
  board_name: string;
  inviter_name: string;
  email: string;
  role: MemberRole;
  status: "pending" | "accepted" | "revoked";
  expires_at: Date;
}

const INVITE_SELECT = `SELECT i.id, i.board_id, b.name AS board_name, u.name AS inviter_name, i.email, i.role, i.status, i.expires_at
  FROM invites i JOIN boards b ON b.id = i.board_id JOIN users u ON u.id = i.inviter_id WHERE i.token = $1`;

const effectiveStatus = (invite: InviteRecord): InviteInfo["status"] =>
  invite.status === "pending" && invite.expires_at.getTime() <= now().getTime() ? "expired" : invite.status;

export async function inviteInfo(token: string): Promise<InviteInfo> {
  const invite = await one<InviteRecord>(pool, INVITE_SELECT, [token]);
  if (!invite) throw notFound();
  return {
    board: { id: invite.board_id, name: invite.board_name },
    inviter: { name: invite.inviter_name },
    role: invite.role,
    status: effectiveStatus(invite),
    expires_at: iso(invite.expires_at),
  };
}

export async function acceptInvite(me: SessionUser, token: string): Promise<{ board_id: number; role: MemberRole }> {
  const result = await tx(async (client) => {
    const located = await one<{ board_id: number }>(client, "SELECT board_id FROM invites WHERE token = $1", [token]);
    if (!located) throw notFound();
    await lockBoards(client, [located.board_id]);
    const invite = await one<InviteRecord>(client, `${INVITE_SELECT} FOR UPDATE OF i`, [token]);
    if (!invite) throw notFound();
    if (normalizeEmail(invite.email) !== normalizeEmail(me.email)) throw forbidden();
    const status = effectiveStatus(invite);
    if (status === "accepted") throw gone("invite_used");
    if (status === "revoked") throw gone("invite_revoked");
    if (status === "expired") throw gone("invite_expired");
    const owner = await exactlyOne<{ owner_id: number; email: string }>(
      client, "SELECT b.owner_id, o.email FROM boards b JOIN users o ON o.id = b.owner_id WHERE b.id = $1", [invite.board_id],
    );
    const member = await one(client, "SELECT 1 FROM board_members WHERE board_id = $1 AND user_id = $2", [invite.board_id, me.id]);
    if (member || owner.owner_id === me.id) throw conflict("already_member");
    await client.query("INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)", [invite.board_id, me.id, invite.role]);
    await client.query("UPDATE invites SET status = 'accepted' WHERE id = $1", [invite.id]);
    await emit(client, { kind: "person", user: me.id }, { type: "membership", board_id: invite.board_id, role: invite.role });
    await emitViewers(client, invite.board_id);
    return { boardId: invite.board_id, role: invite.role, boardName: invite.board_name, ownerEmail: owner.email };
  });
  sendMailInBackground(result.ownerEmail, `${me.name} joined ${result.boardName}`, `${me.name} accepted your invite and joined "${result.boardName}" as ${roleLabel(result.role)}.\n`);
  return { board_id: result.boardId, role: result.role };
}
