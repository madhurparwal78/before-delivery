/** Invites, joining and the friends list with live presence. */

import type { Pool } from "../db/pool.js";
import { randomBytes } from "node:crypto";
import { newId, hashPasscode } from "../db/seed.js";
import { config } from "../config.js";
import { Plans } from "../../shared/data.js";
import { publish } from "../api/events.js";
import { isoInstant, zoneLabelWithZone } from "../time.js";

export interface InviteRow {
  id: string;
  server_id: string;
  email: string;
  token: string;
  state: "pending" | "used" | "expired" | "superseded";
  mail_state: "sent" | "held";
  inviter_id: string;
  created_at: Date;
  expires_at: Date;
}

export interface InviteView {
  id: string;
  email: string;
  state: "pending" | "used" | "expired" | "superseded";
  mail: "sent" | "held";
  expires_at: string;
}

function view(row: InviteRow): InviteView {
  return { id: row.id, email: row.email, state: row.state, mail: row.mail_state, expires_at: isoInstant(row.expires_at) };
}

export type InviteError = "already_member" | "member_limit";

/** Sends one invite, superseding earlier pending invites for the email. */
export async function createInvite(
  pool: Pool,
  input: { serverId: string; email: string; inviterId: string }
): Promise<{ ok: boolean; error?: InviteError; invite?: InviteView }> {
  const client = await pool.connect();
  let invite: InviteRow | null = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`invite:${input.serverId}:${input.email.toLowerCase()}`]);
    const member = (
      await client.query("SELECT 1 FROM members m JOIN users u ON u.id = m.user_id WHERE m.server_id = $1 AND lower(u.email) = lower($2)", [
        input.serverId,
        input.email,
      ])
    ).rows;
    if (member.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "already_member" };
    }
    const server = (await client.query<{ name: string; slug: string; time_zone: string; plan: "hamlet" | "borough" }>(
      "SELECT name, slug, time_zone, plan FROM servers WHERE id = $1",
      [input.serverId]
    )).rows[0];
    if (server === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "already_member" };
    }
    const count = (await client.query<{ n: string }>("SELECT count(*)::text AS n FROM members WHERE server_id = $1", [input.serverId])).rows[0];
    if (Number(count?.n ?? 0) >= Plans[server.plan].members) {
      await client.query("ROLLBACK");
      return { ok: false, error: "member_limit" };
    }
    await client.query("UPDATE invites SET state = 'superseded' WHERE server_id = $1 AND email = $2 AND state = 'pending'", [
      input.serverId,
      input.email,
    ]);
    const id = newId();
    const token = randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + config().inviteTtlSeconds * 1000);
    await client.query(
      "INSERT INTO invites (id, server_id, email, token, state, mail_state, inviter_id, expires_at) VALUES ($1,$2,$3,$4,'pending','held',$5,$6)",
      [id, input.serverId, input.email, token, input.inviterId, expires]
    );
    invite = {
      id,
      server_id: input.serverId,
      email: input.email,
      token,
      state: "pending",
      mail_state: "held",
      inviter_id: input.inviterId,
      created_at: new Date(),
      expires_at: expires,
    };
    const inviter = (await client.query<{ display_name: string; handle: string }>(
      "SELECT display_name, handle FROM users WHERE id = $1",
      [input.inviterId]
    )).rows[0];
    if (inviter !== undefined) {
      const expiryLabel = zoneLabelWithZone(expires, server.time_zone);
      await client.query(
        `INSERT INTO mail_outbox (id, server_id, kind, to_handle, to_email, subject, body, state, dedupe_key)
         VALUES ($1,$2,'invite',$3,$4,$5,$6,'held',$7)`,
        [
          newId(),
          input.serverId,
          inviter.handle,
          input.email,
          `${inviter.display_name} invited you to ${server.name}`,
          [
            `${inviter.display_name} invited you to play on ${server.name} in Plotwright.`,
            `Join with this one-time link: ${config().publicBase}/join/${token}`,
            `The link works once and expires at ${expiryLabel}.`,
          ].join("\n"),
          `invite:${id}`,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }
  await publishInvite(pool, input.serverId, input.inviterId);
  return { ok: true, invite: invite === null ? undefined : view(invite) };
}

async function publishInvite(pool: Pool, serverId: string, inviterId: string): Promise<void> {
  const invites = await pool.query<InviteRow>(
    "SELECT * FROM invites WHERE server_id = $1 AND inviter_id = $2 ORDER BY created_at DESC LIMIT 20",
    [serverId, inviterId]
  );
  const inviter = (await pool.query<{ handle: string }>("SELECT handle FROM users WHERE id = $1", [inviterId])).rows[0];
  if (inviter === undefined) return;
  await publish(pool, serverId, [{ kind: "invite", payload: { invites: invites.rows.map(view) }, audience: { users: [inviter.handle] } }]);
}

export async function myInvites(pool: Pool, serverId: string, userId: string): Promise<InviteView[]> {
  const rows = await pool.query<InviteRow>(
    "SELECT * FROM invites WHERE server_id = $1 AND inviter_id = $2 ORDER BY created_at DESC",
    [serverId, userId]
  );
  return rows.rows.map(view);
}

export async function inviteByToken(
  pool: Pool,
  token: string
): Promise<{ server_name: string; inviter: string; email: string } | { error: "used" | "expired" | "superseded" | "unknown" }> {
  await expireOldInvites(pool);
  const row = (await pool.query<InviteRow & { server_name: string; inviter: string }>(
    `SELECT i.*, s.name AS server_name, u.display_name AS inviter FROM invites i
     JOIN servers s ON s.id = i.server_id JOIN users u ON u.id = i.inviter_id WHERE i.token = $1`,
    [token]
  )).rows[0];
  if (row === undefined) return { error: "unknown" };
  if (row.state === "used") return { error: "used" };
  if (row.state === "superseded") return { error: "superseded" };
  if (row.state === "expired" || row.expires_at.getTime() < Date.now()) return { error: "expired" };
  return { server_name: row.server_name, inviter: row.inviter, email: row.email };
}

async function expireOldInvites(pool: Pool | { query: (text: string) => Promise<unknown> }): Promise<void> {
  await pool.query("UPDATE invites SET state = 'expired' WHERE state = 'pending' AND expires_at < now()");
}

export type JoinError = "used" | "expired" | "superseded" | "email_in_use" | "member_limit" | "handle_taken";

/** Accepts an invite: creates the account, signs it in and makes it a member. */
export async function acceptInvite(
  pool: Pool,
  token: string,
  input: { handle: string; display_name: string; passcode: string }
): Promise<{ ok: true; userId: string; serverId: string } | { ok: false; error: JoinError }> {
  const client = await pool.connect();
  let userId = "";
  let serverId = "";
  try {
    await client.query("BEGIN");
    await expireOldInvites(client);
    const invite = (await client.query<InviteRow>("SELECT * FROM invites WHERE token = $1 FOR UPDATE", [token])).rows[0];
    if (invite === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "expired" };
    }
    if (invite.state === "used") {
      await client.query("ROLLBACK");
      return { ok: false, error: "used" };
    }
    if (invite.state === "superseded") {
      await client.query("ROLLBACK");
      return { ok: false, error: "superseded" };
    }
    if (invite.state === "expired" || invite.expires_at.getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return { ok: false, error: "expired" };
    }
    const emailUsed = (await client.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [invite.email])).rows;
    if (emailUsed.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "email_in_use" };
    }
    const handleTaken = (await client.query("SELECT 1 FROM users WHERE handle = $1", [input.handle])).rows;
    if (handleTaken.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "handle_taken" };
    }
    const server = (await client.query<{ plan: "hamlet" | "borough" }>("SELECT plan FROM servers WHERE id = $1", [invite.server_id])).rows[0];
    const count = (await client.query<{ n: string }>("SELECT count(*)::text AS n FROM members WHERE server_id = $1", [invite.server_id])).rows[0];
    if (server !== undefined && Number(count?.n ?? 0) >= Plans[server.plan].members) {
      await client.query("ROLLBACK");
      return { ok: false, error: "member_limit" };
    }
    userId = newId();
    serverId = invite.server_id;
    await client.query("INSERT INTO users (id, handle, display_name, email, passcode_hash) VALUES ($1,$2,$3,$4,$5)", [
      userId,
      input.handle,
      input.display_name,
      invite.email,
      hashPasscode(input.passcode),
    ]);
    await client.query("INSERT INTO members (server_id, user_id) VALUES ($1,$2)", [serverId, userId]);
    await client.query("UPDATE invites SET state = 'used' WHERE id = $1", [invite.id]);
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }
  await publishFriends(pool, serverId);
  return { ok: true, userId, serverId };
}

/** The friends list of a server, with presence. */
export async function friendsList(pool: Pool, serverId: string): Promise<{ handle: string; display_name: string; online: boolean }[]> {
  const rows = await pool.query<{ handle: string; display_name: string }>(
    `SELECT u.handle, u.display_name FROM members m JOIN users u ON u.id = m.user_id WHERE m.server_id = $1 ORDER BY u.display_name`,
    [serverId]
  );
  const { presence } = await import("../api/presence.js");
  return rows.rows.map((r) => ({ handle: r.handle, display_name: r.display_name, online: presence.isOnline(serverId, r.handle) }));
}

export async function publishFriends(pool: Pool, serverId: string): Promise<void> {
  const friends = await friendsList(pool, serverId);
  await publish(pool, serverId, [{ kind: "friends", payload: { friends } }]);
}

/** The owner's mail list. */
export async function mailList(
  pool: Pool,
  serverId: string
): Promise<{ id: string; kind: string; to_handle: string | null; subject: string; state: "held" | "sent"; created_at: string; sent_at: string | null }[]> {
  const rows = await pool.query<{ id: string; kind: string; to_handle: string | null; subject: string; state: "held" | "sent"; created_at: Date; sent_at: Date | null }>(
    "SELECT id, kind, to_handle, subject, state, created_at, sent_at FROM mail_outbox WHERE server_id = $1 ORDER BY created_at DESC LIMIT 100",
    [serverId]
  );
  return rows.rows.map((r) => ({ ...r, created_at: isoInstant(r.created_at), sent_at: r.sent_at === null ? null : isoInstant(r.sent_at) }));
}
