// Invites: seat-checked against the confirmed limit, emailed without any token, accepted by the
// person who signs in with the invited address.
import { randomUUID } from "node:crypto";
import { personJson, viewerOf, type PersonRow, type Viewer } from "./access.js";
import { joinChannel } from "./chat.js";
import { config } from "./config.js";
import { query, tx, type Db } from "./db.js";
import { emailKey, validEmail } from "./emails.js";
import { ApiError, invalid } from "./errors.js";
import { inviteStatus, liveBefore, type InviteStatus } from "./expiry.js";
import { route } from "./router.js";
import { dropHeldMail, queueMail } from "./outbox.js";
import { confirmedLimit, seatsAllow, seatUse } from "./seats.js";
import { isoInstant, nowMs } from "./time.js";
import { workspaceFor, zoneOf } from "./workspace.js";

interface InviteRow {
  id: string;
  workspace_id: string;
  email: string;
  role: "member" | "guest";
  project_ids: string[];
  channel_ids: string[];
  status: InviteStatus;
  created_at: number;
  expires_at: number;
  workspace_name: string;
  owner_name: string;
}

const INVITE_SELECT = `
  SELECT i.id, i.workspace_id, i.email, i.role, i.project_ids, i.channel_ids, i.status, i.created_at, i.expires_at,
         w.name AS workspace_name, (SELECT name FROM people WHERE workspace_id = w.id AND role = 'owner' LIMIT 1) AS owner_name
  FROM invites i JOIN workspaces w ON w.id = i.workspace_id`;

async function inviteJson(db: Db, invite: InviteRow): Promise<Record<string, unknown>> {
  const zone = await zoneOf(db, invite.workspace_id);
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    project_ids: invite.project_ids,
    channel_ids: invite.channel_ids,
    status: inviteStatus(invite.status, invite.expires_at, nowMs()),
    created_at: isoInstant(invite.created_at, zone),
    expires_at: isoInstant(invite.expires_at, zone),
    workspace_name: invite.workspace_name,
    owner_name: invite.owner_name,
  };
}

async function idsIn(db: Db, table: "projects" | "channels", workspaceId: string, value: unknown): Promise<string[] | null> {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return null;
  const ids = [...new Set(value as string[])];
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM ${table} WHERE workspace_id = $1 AND id::text = ANY($2)`, [workspaceId, ids]);
  return rows.length === ids.length ? rows.map((r) => r.id) : null;
}

route("GET", "/api/invites", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.owner();
  return {
    status: 200,
    body: await tx(async (db) => {
      const { rows } = await db.query<InviteRow>(`${INVITE_SELECT} WHERE i.workspace_id = $1 ORDER BY i.created_at DESC, i.id`, [viewer.workspaceId]);
      const invites = [];
      for (const row of rows) invites.push(await inviteJson(db, row));
      return { invites };
    }),
  };
});

route("POST", "/api/invites", { access: "workspace", idempotent: true }, async (ctx) => {
  const viewer = ctx.owner();
  const { email, role } = ctx.body;
  const checked = await tx(async (db) => {
    const fields: Record<string, string> = {};
    if (!validEmail(email)) fields.email = "Enter an email address.";
    if (role !== "member" && role !== "guest") fields.role = "Choose member or guest.";
    const projectIds = await idsIn(db, "projects", viewer.workspaceId, ctx.body.project_ids);
    const channelIds = await idsIn(db, "channels", viewer.workspaceId, ctx.body.channel_ids);
    if (!projectIds) fields.project_ids = "Choose projects of this workspace.";
    if (!channelIds) fields.channel_ids = "Choose channels of this workspace.";
    if (projectIds && channelIds) {
      if (role === "guest" && projectIds.length + channelIds.length === 0) fields.project_ids = "Share at least one project or channel with a guest.";
      if (role === "member" && projectIds.length + channelIds.length > 0) fields.project_ids = "Members see every project; share nothing extra.";
    }
    if (Object.keys(fields).length) throw invalid(fields);
    return { projectIds: projectIds as string[], channelIds: channelIds as string[] };
  });
  const limit = await confirmedLimit(viewer.workspaceId, true);
  return tx(async (db) => {
    await db.query("SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE", [viewer.workspaceId]);
    const key = emailKey(email as string);
    const now = nowMs();
    if ((await db.query("SELECT 1 FROM people WHERE workspace_id = $1 AND email_key = $2", [viewer.workspaceId, key])).rows.length) throw new ApiError("already_member");
    const pending = await db.query(`SELECT 1 FROM invites WHERE workspace_id = $1 AND email_key = $2 AND status = 'pending' AND ${liveBefore("expires_at", "$3")}`, [viewer.workspaceId, key, now]);
    if (pending.rows.length) throw new ApiError("invite_pending");
    if (!seatsAllow(await seatUse(db, viewer.workspaceId), limit, "invite")) throw new ApiError("workspace_full");
    const id = randomUUID();
    await db.query(
      "INSERT INTO invites (id, workspace_id, email, email_key, role, project_ids, channel_ids, status, invited_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)",
      [id, viewer.workspaceId, email, key, role, checked.projectIds, checked.channelIds, viewer.id, now, now + config.timers.inviteTtl * 1000],
    );
    const { rows } = await db.query<InviteRow>(`${INVITE_SELECT} WHERE i.id = $1`, [id]);
    const invite = rows[0] as InviteRow;
    await queueMail(db, {
      workspaceId: viewer.workspaceId,
      kind: "invite",
      recipientId: null,
      email: email as string,
      inviteId: id,
      subject: `You're invited to ${invite.workspace_name} on Tallyroom`,
      body: [
        "Hello,",
        "",
        `${viewer.name} has invited you to join ${invite.workspace_name} on Tallyroom.`,
        "",
        `To accept, sign in or create an account at ${config.publicUrl} with this exact address: ${email as string}`,
        "",
        "The invitation will be waiting under Your invitations once you are signed in.",
        "",
      ].join("\n"),
    });
    const reply = { status: 201, body: await inviteJson(db, invite) };
    await ctx.settle(db, reply);
    return reply;
  });
});

route("DELETE", "/api/invites/:id", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.owner();
  return tx(async (db) => {
    const { rows } = await db.query<InviteRow>(`${INVITE_SELECT} WHERE i.id::text = $1 AND i.workspace_id = $2 FOR UPDATE OF i`, [ctx.params.id ?? "", viewer.workspaceId]);
    const invite = rows[0];
    if (!invite) throw new ApiError("not_found");
    if (inviteStatus(invite.status, invite.expires_at, nowMs()) !== "pending") throw new ApiError("invite_not_pending");
    await db.query("UPDATE invites SET status = 'revoked' WHERE id = $1", [invite.id]);
    await dropHeldMail(db, viewer.workspaceId, { inviteId: invite.id });
    return { status: 200, body: await inviteJson(db, { ...invite, status: "revoked" }) };
  });
});

route("GET", "/api/invites/mine", { access: "signed-in" }, async (ctx) => {
  const person = ctx.person;
  return {
    status: 200,
    body: await tx(async (db) => {
      const { rows } = await db.query<InviteRow>(`${INVITE_SELECT} WHERE i.email_key = $1 ORDER BY i.created_at DESC, i.id`, [emailKey(person.email)]);
      const invites = [];
      for (const row of rows) invites.push(await inviteJson(db, row));
      return { invites };
    }),
  };
});

route("POST", "/api/invites/:id/accept", { access: "signed-in" }, async (ctx) => {
  const person = ctx.person;
  const found = await query<InviteRow>(`${INVITE_SELECT} WHERE i.id::text = $1 AND i.email_key = $2`, [ctx.params.id ?? "", emailKey(person.email)]);
  const target = found[0];
  if (!target) throw new ApiError("not_found");
  const limit = await confirmedLimit(target.workspace_id, true);
  const accepted = await tx(async (db) => {
    await db.query("SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE", [target.workspace_id]);
    const { rows: me } = await db.query<PersonRow>("SELECT id, name, email, handle, role, workspace_id FROM people WHERE id = $1 FOR UPDATE", [person.id]);
    if (me[0]?.workspace_id) throw new ApiError("already_in_workspace");
    const { rows } = await db.query<InviteRow>(`${INVITE_SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [target.id]);
    const invite = rows[0] as InviteRow;
    const status = inviteStatus(invite.status, invite.expires_at, nowMs());
    if (status === "expired") throw new ApiError("invite_expired");
    if (status === "revoked") throw new ApiError("invite_revoked");
    if (status === "accepted") throw new ApiError("invite_accepted");
    if (!seatsAllow(await seatUse(db, invite.workspace_id), limit, "accept")) throw new ApiError("workspace_full");
    await db.query("UPDATE people SET workspace_id = $2, role = $3, last_active_at = $4, presence = 'active' WHERE id = $1", [person.id, invite.workspace_id, invite.role, nowMs()]);
    await db.query("UPDATE invites SET status = 'accepted' WHERE id = $1", [invite.id]);
    await dropHeldMail(db, invite.workspace_id, { inviteId: invite.id });
    const channels =
      invite.role === "member"
        ? (await db.query<{ id: string }>("SELECT id FROM channels WHERE workspace_id = $1 AND is_default", [invite.workspace_id])).rows.map((r) => r.id)
        : invite.channel_ids;
    for (const channelId of channels) await joinChannel(db, invite.workspace_id, channelId, person.id);
    for (const projectId of invite.role === "guest" ? invite.project_ids : []) {
      await db.query("INSERT INTO project_guests (project_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [projectId, person.id]);
    }
    return { ...person, workspace_id: invite.workspace_id, role: invite.role };
  });
  return { status: 200, body: { person: personJson(accepted), workspace: await workspaceFor(viewerOf(accepted) as Viewer) } };
});
