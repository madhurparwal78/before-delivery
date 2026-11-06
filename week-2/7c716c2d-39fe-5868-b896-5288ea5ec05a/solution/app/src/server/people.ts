// Accounts, sessions, the member list, removal, and guest project membership.
import { randomUUID } from "node:crypto";
import { canSeeProject, personJson, projectAudience, viewerOf, visiblePeople, visibleProjectIds, type PersonRow, type Viewer } from "./access.js";
import { clearedCookie, createSession, endSession, sessionCookie } from "./auth.js";
import { emailKey, validEmail } from "./emails.js";
import { one, tx, type Db } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { emit, latestEventId } from "./events.js";
import { route } from "./router.js";
import { dropHeldMail } from "./outbox.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { typingList } from "./presence.js";
import { expireKnocksOf, leaveRoom } from "./rooms.js";
import { textWithin } from "../shared/text.js";
import { nowMs } from "./time.js";
import { emitUnread, unreadBody } from "./unread.js";
import { channelsFor } from "./chat.js";
import { loadCalendar } from "./calendar.js";
import { workspaceFor } from "./workspace.js";

async function meBody(person: PersonRow): Promise<Record<string, unknown>> {
  const viewer = viewerOf(person);
  return { person: personJson(person), workspace: viewer ? await workspaceFor(viewer) : null };
}

async function uniqueHandle(db: Db, email: string): Promise<string> {
  const base = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30) || "person";
  for (let n = 0; ; n++) {
    const handle = n === 0 ? base : `${base}${n + 1}`;
    const { rows } = await db.query("SELECT 1 FROM people WHERE handle = $1", [handle]);
    if (!rows.length) return handle;
  }
}

route("POST", "/api/accounts", { access: "public" }, async (ctx) => {
  const { name, email, password } = ctx.body;
  const fields: Record<string, string> = {};
  if (!textWithin(name, 1, 80)) fields.name = "Enter a name of 1 to 80 characters.";
  if (!validEmail(email)) fields.email = "Enter an email address.";
  if (!textWithin(password, 8, 128)) fields.password = "Use 8 to 128 characters.";
  if (Object.keys(fields).length) throw invalid(fields);
  const hash = await hashPassword(password as string);
  const { person, token } = await tx(async (db) => {
    const key = emailKey(email as string);
    await db.query("SELECT pg_advisory_xact_lock(hashtext('tr-account:' || $1))", [key]);
    const { rows } = await db.query("SELECT 1 FROM people WHERE email_key = $1", [key]);
    if (rows.length) throw new ApiError("email_taken");
    const id = randomUUID();
    const handle = await uniqueHandle(db, email as string);
    await db.query("INSERT INTO people (id, name, email, email_key, handle, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, name, email, key, handle, hash, nowMs()]);
    return { person: { id, name: name as string, email: email as string, handle, role: null }, token: await createSession(db, id) };
  });
  return { status: 201, body: { person: personJson(person) }, headers: { "Set-Cookie": sessionCookie(token) } };
});

route("POST", "/api/session", { access: "public" }, async (ctx) => {
  const { email, password } = ctx.body;
  if (typeof email !== "string" || typeof password !== "string") throw new ApiError("invalid_credentials");
  const person = await one<PersonRow & { password_hash: string }>(
    "SELECT id, name, email, handle, role, workspace_id, password_hash FROM people WHERE email_key = $1",
    [emailKey(email)],
  );
  if (!person || !(await verifyPassword(password, person.password_hash))) throw new ApiError("invalid_credentials");
  const token = await tx((db) => createSession(db, person.id));
  return { status: 200, body: await meBody(person), headers: { "Set-Cookie": sessionCookie(token) } };
});

route("DELETE", "/api/session", { access: "signed-in" }, async (ctx) => {
  const person = ctx.person;
  if (person.workspace_id) {
    const workspaceId = person.workspace_id;
    await tx((db) => leaveRoom(db, workspaceId, person.id));
  }
  await endSession(ctx.req);
  return { status: 204, headers: { "Set-Cookie": clearedCookie() } };
});

route("POST", "/api/account/password", { access: "signed-in" }, async (ctx) => {
  const person = ctx.person;
  const { current_password: current, new_password: next } = ctx.body;
  if (!textWithin(next, 8, 128)) throw invalid({ new_password: "Use 8 to 128 characters." });
  const stored = await one<{ password_hash: string }>("SELECT password_hash FROM people WHERE id = $1", [person.id]);
  if (typeof current !== "string" || !stored || !(await verifyPassword(current, stored.password_hash))) throw new ApiError("invalid_credentials", null, null, 403);
  const hash = await hashPassword(next);
  await tx(async (db) => {
    await db.query("UPDATE people SET password_hash = $2 WHERE id = $1", [person.id, hash]);
    const { rows } = await db.query<{ token_hash: string }>("DELETE FROM sessions WHERE person_id = $1 AND token_hash <> $2 RETURNING token_hash", [person.id, person.session_id]);
    if (person.workspace_id && rows.length > 0) {
      await emit(db, person.workspace_id, "revoked", { scope: "workspace", id: person.workspace_id }, { recipients: [person.id], sessions: rows.map((r) => r.token_hash) });
    }
  });
  return { status: 204 };
});

route("GET", "/api/me", { access: "signed-in" }, async (ctx) => ({ status: 200, body: await meBody(ctx.person) }));

/** Visible people; with `?project=<id>` only those who can see that project (the assignee options). */
route("GET", "/api/members", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  const project = ctx.query.get("project");
  const people = await tx(async (db) => {
    const visible = await visiblePeople(db, viewer);
    if (project === null) return visible;
    if (!(await canSeeProject(db, viewer, project))) throw new ApiError("not_found");
    const audience = new Set((await projectAudience(db, viewer.workspaceId, project)).map((p) => p.id));
    return visible.filter((p) => audience.has(p.id));
  });
  return { status: 200, body: { members: people.map(personJson) } };
});

route("DELETE", "/api/members/:person", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  await tx(async (db) => {
    const { rows } = await db.query<{ id: string; role: string }>("SELECT id, role FROM people WHERE id::text = $1 AND workspace_id = $2 FOR UPDATE", [ctx.params.person ?? "", viewer.workspaceId]);
    const person = rows[0];
    if (!person) throw new ApiError("not_found");
    if (viewer.role !== "owner") throw new ApiError("forbidden");
    if (person.id === viewer.id) throw new ApiError("owner_required");
    await dropHeldMail(db, viewer.workspaceId, { personId: person.id });
    await leaveRoom(db, viewer.workspaceId, person.id);
    await expireKnocksOf(db, person.id);
    const { rows: typed } = await db.query<{ channel_id: string }>("DELETE FROM typing WHERE person_id = $1 RETURNING channel_id", [person.id]);
    for (const { channel_id: channelId } of typed) await emit(db, viewer.workspaceId, "typing", { channel_id: channelId, typing: await typingList(db, channelId) }, { channelId });
    await db.query("DELETE FROM channel_members WHERE person_id = $1", [person.id]);
    await db.query("DELETE FROM project_guests WHERE person_id = $1", [person.id]);
    await db.query("DELETE FROM sessions WHERE person_id = $1", [person.id]);
    await db.query("UPDATE people SET workspace_id = NULL, role = NULL WHERE id = $1", [person.id]);
    await emit(db, viewer.workspaceId, "revoked", { scope: "workspace", id: viewer.workspaceId }, { recipients: [person.id] });
  });
  return { status: 204 };
});

async function projectsFor(db: Db, viewer: Viewer): Promise<{ id: string; key: string; name: string }[]> {
  const { rows } = await db.query<{ id: string; key: string; name: string }>("SELECT id, key, name FROM projects WHERE id = ANY($1) ORDER BY lower(name)", [await visibleProjectIds(db, viewer)]);
  return rows;
}

route("GET", "/api/projects", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return { status: 200, body: { projects: await tx((db) => projectsFor(db, viewer)) } };
});

/** What a page needs for its first paint, embedded in the page so it renders without waiting:
 * the same bodies as /api/me, /api/projects, /api/members, /api/channels, /api/unread and the
 * current cycle number, plus the event cursor they were read at. Null when the request carries no session. */
export async function bootstrap(person: PersonRow | null): Promise<Record<string, unknown> | null> {
  if (!person) return null;
  const me = await meBody(person);
  const viewer = viewerOf(person);
  if (!viewer) return { me };
  return {
    me,
    ...(await tx(async (db) => ({
      last_event_id: await latestEventId(db, viewer.workspaceId),
      projects: await projectsFor(db, viewer),
      members: (await visiblePeople(db, viewer)).map(personJson),
      channels: await channelsFor(db, viewer),
      unread: await unreadBody(db, viewer.id),
      current_cycle: (await loadCalendar(db, viewer.workspaceId)).currentNumber(),
    }))),
  };
}

async function workspaceProject(db: Db, viewer: Viewer, projectId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM projects WHERE id::text = $1 AND workspace_id = $2", [projectId, viewer.workspaceId]);
  if (!rows[0]) throw new ApiError("not_found");
  if (viewer.role !== "owner") throw new ApiError("forbidden");
  return rows[0].id;
}

route("POST", "/api/projects/:id/members", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  await tx(async (db) => {
    const projectId = await workspaceProject(db, viewer, ctx.params.id ?? "");
    const personId = ctx.body.person_id;
    const { rows } = await db.query<{ id: string }>("SELECT id FROM people WHERE id::text = $1 AND workspace_id = $2 AND role = 'guest'", [typeof personId === "string" ? personId : "", viewer.workspaceId]);
    if (!rows[0]) throw invalid({ person_id: "Choose a guest in this workspace." });
    await db.query("INSERT INTO project_guests (project_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [projectId, rows[0].id]);
  });
  return { status: 204 };
});

route("DELETE", "/api/projects/:id/members/:person", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  await tx(async (db) => {
    const projectId = await workspaceProject(db, viewer, ctx.params.id ?? "");
    const { rows } = await db.query<{ person_id: string }>("DELETE FROM project_guests WHERE project_id = $1 AND person_id::text = $2 RETURNING person_id", [projectId, ctx.params.person ?? ""]);
    const removed = rows[0]?.person_id;
    if (!removed) return;
    await emit(db, viewer.workspaceId, "revoked", { scope: "project", id: projectId }, { recipients: [removed] });
    await emitUnread(db, viewer.workspaceId, [removed]);
  });
  return { status: 204 };
});
