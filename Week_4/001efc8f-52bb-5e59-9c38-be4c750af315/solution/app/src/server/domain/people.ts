import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { now } from "../clock.js";
import { config } from "../config.js";
import { one, pool, rows, tx } from "../db.js";
import { ApiError, FIELD, invalid, type FieldErrors } from "../errors.js";
import { logEvents } from "../events.js";
import type { Viewer } from "../http.js";
import { sendMail } from "../services/smtp.js";
import { isUuid } from "./ids.js";
import { hashPassword } from "./passwords.js";
import { projectUser, type UserJson, type UserRow } from "./projection.js";
import { managesPeople, ROLES, type Role } from "./roles.js";

const NAME_MAX = 80;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
const USER_COLUMNS = "u.id, u.name, u.handle, u.email, u.role, u.status";

// Invite names: trimmed, not empty, no line breaks or control characters, at most 80 characters.
function nameError(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "") return FIELD.nameEmpty;
  if (/\p{Cc}/u.test(name)) return FIELD.nameControl;
  if ([...name].length > NAME_MAX) return FIELD.nameLong;
  return null;
}

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@<>()",;:\\[\]\p{Cc}]+@[^\s@<>()",;:\\[\]\p{Cc}]+\.[^\s@<>()",;:\\[\]\p{Cc}]+$/u.test(email);
}

function handleBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 30)
    .replace(/\.+$/, "");
  return slug === "" ? "member" : slug;
}

async function freeHandle(client: pg.PoolClient, workspaceId: string, name: string): Promise<string> {
  const base = handleBase(name);
  const taken = new Set(
    (await rows<{ handle: string }>(client, "SELECT lower(handle) AS handle FROM users WHERE workspace_id = $1 AND lower(handle) LIKE $2", [
      workspaceId, `${base.replace(/[\\%_]/g, "\\$&")}%`,
    ])).map((r) => r.handle),
  );
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}${n}`;
  return candidate;
}

export async function workspaceMembers(viewer: Viewer, q: string | null): Promise<UserJson[]> {
  const prefix = (q ?? "").trim().toLowerCase();
  const found = await rows<UserRow>(
    pool,
    `SELECT ${USER_COLUMNS} FROM users u
      WHERE u.workspace_id = $1
        AND ($2 = '' OR starts_with(lower(u.name), $2) OR starts_with(lower(u.handle), $2) OR ($3 AND starts_with(lower(u.email), $2)))
      ORDER BY u.name, u.id`,
    [viewer.workspace.id, prefix, viewer.role === "ops_manager"],
  );
  return found.map((u) => projectUser(viewer, u));
}

function inviteMail(invitee: { name: string; email: string }, inviter: string, workspace: string, token: string) {
  return {
    toName: invitee.name,
    toAddress: invitee.email,
    subject: `Join ${workspace} on Rimewire`,
    text: [
      `Hello ${invitee.name},`,
      "",
      `${inviter} has invited you to Rimewire.`,
      "",
      "Set your password and join here:",
      `${config.publicUrl}/join/${token}`,
      "",
    ].join("\n"),
  };
}

// Sends one invite email, once. Locked so the request and the retry worker never both send.
async function deliverInvite(token: string): Promise<"sent" | "queued"> {
  try {
    return await tx(async (client) => {
      const invite = await one<{ email_sent_at: Date | null; name: string; email: string; inviter: string; workspace: string }>(
        client,
        `SELECT i.email_sent_at, u.name, u.email, iu.name AS inviter, w.name AS workspace
           FROM invites i JOIN users u ON u.id = i.user_id JOIN users iu ON iu.id = i.invited_by JOIN workspaces w ON w.id = u.workspace_id
          WHERE i.token = $1 FOR UPDATE OF i SKIP LOCKED`,
        [token],
      );
      if (!invite) return "queued";
      if (invite.email_sent_at) return "sent";
      await sendMail(inviteMail(invite, invite.inviter, invite.workspace, token));
      await client.query("UPDATE invites SET email_sent_at = $2 WHERE token = $1", [token, now()]);
      return "sent";
    });
  } catch {
    return "queued";
  }
}

export async function retryInvites(): Promise<void> {
  const pending = await rows<{ token: string }>(pool, "SELECT token FROM invites WHERE email_sent_at IS NULL AND accepted_at IS NULL ORDER BY created_at");
  for (const invite of pending) {
    if ((await deliverInvite(invite.token)) === "queued") return;
  }
}

export async function invitePerson(viewer: Viewer, value: Record<string, unknown>): Promise<{ member: UserJson; invite_email: "sent" | "queued" }> {
  if (!managesPeople(viewer.role)) throw new ApiError("forbidden");
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  if (validEmail(email) && (await one(pool, "SELECT 1 FROM users WHERE lower(email) = $1", [email]))) throw new ApiError("email_taken");
  const errors: FieldErrors = {};
  const badName = nameError(value.name);
  if (badName) errors.name = badName;
  if (!validEmail(email)) errors.email = FIELD.email;
  if (typeof value.role !== "string" || !ROLES.includes(value.role as Role)) errors.role = FIELD.role;
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const name = (value.name as string).trim();

  const token = randomBytes(24).toString("base64url");
  const member = await tx(async (client) => {
    const id = randomUUID();
    const at = now();
    const created = await client.query(
      `INSERT INTO users (id, workspace_id, name, handle, email, role, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'invited', $7) ON CONFLICT DO NOTHING`,
      [id, viewer.workspace.id, name, await freeHandle(client, viewer.workspace.id, name), email, value.role, at],
    );
    if (created.rowCount === 0) throw new ApiError("email_taken");
    await client.query("INSERT INTO invites (token, user_id, invited_by, created_at) VALUES ($1, $2, $3, $4)", [token, id, viewer.id, at]);
    return one<UserRow>(client, `SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
  });
  if (!member) throw new ApiError("internal_error");
  return { member: projectUser(viewer, member), invite_email: await deliverInvite(token) };
}

type OpenInvite = { user_id: string; name: string; email: string; workspace_name: string };

// Invite tokens are base64url; anything else is unknown before any lookup.
const INVITE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

async function openInvite(db: pg.Pool | pg.PoolClient, token: string, forUpdate: boolean): Promise<OpenInvite> {
  if (!INVITE_TOKEN.test(token)) throw new ApiError("not_found");
  const row = await one<OpenInvite>(
    db,
    `SELECT u.id AS user_id, u.name, u.email, w.name AS workspace_name
       FROM invites i JOIN users u ON u.id = i.user_id JOIN workspaces w ON w.id = u.workspace_id
      WHERE i.token = $1 AND i.accepted_at IS NULL AND u.status = 'invited' ${forUpdate ? "FOR UPDATE OF i" : ""}`,
    [token],
  );
  if (!row) throw new ApiError("not_found");
  return row;
}

export async function inviteDetails(token: string): Promise<{ workspace_name: string; name: string; email: string }> {
  const invite = await openInvite(pool, token, false);
  return { workspace_name: invite.workspace_name, name: invite.name, email: invite.email };
}

export async function acceptInvite(token: string, value: Record<string, unknown>): Promise<string> {
  return tx(async (client) => {
    const invite = await openInvite(client, token, true);
    const password = value.password;
    const length = typeof password === "string" ? [...password].length : 0;
    if (typeof password !== "string" || length < PASSWORD_MIN || length > PASSWORD_MAX) throw invalid({ password: FIELD.passwordJoin });
    const at = now();
    await client.query("UPDATE users SET password_hash = $2, status = 'active' WHERE id = $1", [invite.user_id, await hashPassword(password)]);
    await client.query("UPDATE invites SET accepted_at = $2 WHERE token = $1", [token, at]);
    return invite.user_id;
  });
}

export async function deactivatePerson(viewer: Viewer, userId: string): Promise<UserJson> {
  if (!managesPeople(viewer.role)) throw new ApiError("forbidden");
  if (!isUuid(userId)) throw new ApiError("not_found");
  return tx(async (client) => {
    const person = await one<UserRow>(client, `SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1 AND u.workspace_id = $2 FOR UPDATE`, [userId, viewer.workspace.id]);
    if (!person) throw new ApiError("not_found");
    if (person.id === viewer.id) throw new ApiError("cannot_deactivate_self");
    await client.query("UPDATE users SET status = 'deactivated' WHERE id = $1", [person.id]);
    await client.query("DELETE FROM sessions WHERE user_id = $1", [person.id]);
    await client.query("DELETE FROM memberships WHERE user_id = $1", [person.id]);
    await logEvents(client, async () => [{ workspaceId: viewer.workspace.id, channelId: null, userId: person.id, name: "session.ended", payload: {} }]);
    return projectUser(viewer, { ...person, status: "deactivated" });
  });
}
