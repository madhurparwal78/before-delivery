// Members, invitations and offboarding.
import type { Role } from "../../shared/api-types.js";
import { isoSecond } from "../../shared/format.js";
import { isName, type FieldErrors } from "../../shared/graph.js";
import { authorOf, hashPassword, randomToken, secretHash, sessionCookie, startSession } from "../auth.js";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { one, pool, rows, transaction } from "../db.js";
import { conflict, invalid, notFound } from "../errors.js";
import { json, noContent, publicRoute, route } from "../http.js";
import { announce } from "../events.js";
import { authorize, authorizeInvite } from "../domain/permissions.js";
import { clearAuthor } from "../domain/locks.js";
import { lockSeats, seatsUsed } from "../domain/seats.js";
import { assertWritable, loadSubscription, seatsPurchased } from "../domain/subscription.js";
import { enqueueMail } from "../services/mail.js";
import { loadWorkspace, workspaceSummary } from "../workspace.js";
import { EMAIL, bodyOf, emailTaken, memberOut, newId, type MemberRow } from "./account.js";

const INVITABLE: readonly Role[] = ["admin", "billing_manager", "editor", "viewer"];
const INVITE_DAYS = 7;

interface InviteRow {
  id: string; workspace_id: string; email: string; role: Role; invited_by_kind: "member"; invited_by_id: string; invited_by_name: string;
  created_at: Date; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null;
}

const openInvite = "accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2";

route("GET", "/api/members", async ({ caller }) => {
  authorize(caller, "workspace.read");
  const members = await rows<MemberRow>(pool, "SELECT * FROM members WHERE workspace_id = $1 AND removed_at IS NULL ORDER BY joined_at, id", [caller.workspaceId]);
  const invites = await rows<InviteRow>(pool, `SELECT * FROM invites WHERE workspace_id = $1 AND ${openInvite} ORDER BY created_at`, [caller.workspaceId, new Date()]);
  return json(200, {
    members: members.map(memberOut),
    invites: invites.map((i) => ({
      id: i.id, email: i.email, role: i.role, expiresAt: isoSecond(i.expires_at),
      invitedBy: { kind: i.invited_by_kind, id: i.invited_by_id, name: i.invited_by_name },
    })),
  });
});

route("POST", "/api/members/invites", async (ctx) => {
  const body = bodyOf(ctx);
  authorizeInvite(ctx.caller, String(body.role));
  const { caller } = ctx;
  await assertWritable(caller.workspaceId);
  const errors: FieldErrors = {};
  if (typeof body.email !== "string" || !EMAIL.test(body.email)) errors.email = "Enter an email address";
  if (!INVITABLE.some((r) => r === body.role)) errors.role = "Choose admin, billing manager, editor or viewer";
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const email = String(body.email);
  const role = String(body.role);
  const token = randomToken();
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const invite = await transaction(async (client) => {
    await lockSeats(client, ws.id);
    const now = new Date();
    const duplicate = await one(client,
      `SELECT 1 FROM members WHERE workspace_id = $1 AND lower(email) = lower($3) AND removed_at IS NULL
       UNION ALL SELECT 1 FROM invites WHERE workspace_id = $1 AND lower(email) = lower($3) AND ${openInvite}`, [ws.id, now, email]);
    if (duplicate) throw conflict("already_member");
    const used = await seatsUsed(client, ws.id, now);
    const purchased = seatsPurchased(await loadSubscription(client, ws.id));
    if (used >= purchased) throw conflict("no_seats_left", { seatsUsed: used, seatsPurchased: purchased });
    const [row] = await rows<InviteRow>(client,
      `INSERT INTO invites (id, workspace_id, email, role, token_hash, invited_by_kind, invited_by_id, invited_by_name, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'member', $6, $7, $8, $9) RETURNING *`,
      [newId("inv"), ws.id, email, role, secretHash(token), caller.id, caller.name, now, new Date(now.getTime() + INVITE_DAYS * 86_400_000)]);
    await audit(client, ws.id, authorOf(caller), "member.invited", { type: "invite", id: row.id });
    await enqueueMail(client, {
      to: [email], fromName: `${caller.name} via Orrery Studio`,
      subject: `Join ${ws.name} on Orrery Studio`,
      body: `${caller.name} invited you to join ${ws.name} on Orrery Studio as ${role.replace("_", " ")}.\n\nChoose a password and join here:\n${config.publicUrl}/invite/${token}\n\nThe invitation expires in ${INVITE_DAYS} days.`,
    });
    return row;
  });
  return json(201, { id: invite.id, email: invite.email, role: invite.role, expiresAt: isoSecond(invite.expires_at) });
});

route("DELETE", "/api/members/invites/:inviteId", async ({ caller, params }) => {
  const invite = await one<InviteRow>(pool, "SELECT * FROM invites WHERE id = $1 AND workspace_id = $2", [params.inviteId, caller.workspaceId]);
  if (!invite) throw notFound();
  authorize(caller, "member.invite");
  await transaction(async (client) => {
    await client.query("UPDATE invites SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1", [invite.id]);
    await audit(client, caller.workspaceId, authorOf(caller), "invite.revoked", { type: "invite", id: invite.id });
  });
  return noContent();
});

async function openInviteByToken(token: string): Promise<InviteRow> {
  const invite = await one<InviteRow>(pool, `SELECT * FROM invites WHERE token_hash = $1 AND ${openInvite}`, [secretHash(token), new Date()]);
  if (!invite) throw notFound();
  return invite;
}

publicRoute("GET", "/api/invites/:token", async ({ params }) => {
  const invite = await openInviteByToken(params.token);
  const ws = await loadWorkspace(pool, invite.workspace_id);
  return json(200, { workspace: { name: ws.name }, email: invite.email, role: invite.role });
});

publicRoute("POST", "/api/invites/:token/accept", async (ctx) => {
  const invite = await openInviteByToken(ctx.params.token);
  await assertWritable(invite.workspace_id);
  const body = bodyOf(ctx);
  if (await emailTaken(pool, invite.email)) throw conflict("email_taken");
  const errors: FieldErrors = {};
  if (!isName(body.name)) errors.name = "Use 1 to 80 characters";
  if (typeof body.password !== "string" || body.password.length < 10) errors.password = "Use at least 10 characters";
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const passwordHash = await hashPassword(String(body.password));
  const { member, token } = await transaction(async (client) => {
    if (await emailTaken(client, invite.email)) throw conflict("email_taken");
    const claimed = await client.query("UPDATE invites SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL", [invite.id]);
    if (claimed.rowCount === 0) throw notFound();
    const [created] = await rows<MemberRow>(client,
      "INSERT INTO members (id, workspace_id, name, email, password_hash, role, joined_at) VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING *",
      [newId("mem"), invite.workspace_id, body.name, invite.email, passwordHash, invite.role]);
    await audit(client, invite.workspace_id, { kind: "member", id: created.id, name: created.name }, "member.joined", { type: "member", id: created.id });
    return { member: created, token: await startSession(client, created.id) };
  });
  return json(201, { member: memberOut(member), workspace: workspaceSummary(await loadWorkspace(pool, invite.workspace_id)) },
    { "Set-Cookie": sessionCookie(token) });
});

route("DELETE", "/api/members/:memberId", async ({ caller, params }) => {
  const member = await one<MemberRow>(pool, "SELECT * FROM members WHERE id = $1 AND workspace_id = $2 AND removed_at IS NULL", [params.memberId, caller.workspaceId]);
  if (!member) throw notFound();
  authorize(caller, "member.manage");
  if (member.role === "owner") throw conflict("owner_cannot_be_removed");
  await transaction(async (client) => {
    await client.query("UPDATE members SET removed_at = now() WHERE id = $1", [member.id]);
    await client.query("UPDATE sessions SET ended_at = now() WHERE member_id = $1 AND ended_at IS NULL", [member.id]);
    await audit(client, caller.workspaceId, authorOf(caller), "member.removed", { type: "member", id: member.id });
  });
  const scenes = await clearAuthor({ kind: "member", id: member.id, name: member.name });
  await Promise.all(scenes.flatMap((scene) => [announce(scene, "lock"), announce(scene, "presence")]));
  return noContent();
});
