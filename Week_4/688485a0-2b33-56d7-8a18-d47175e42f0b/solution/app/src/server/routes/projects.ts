import type { JsonObject, JsonValue } from "../../shared/json.js";
import { type Role, collectionAccess, isUuid, projectAccess, requireOwner } from "../access.js";
import { requireUser } from "../auth.js";
import { config } from "../config.js";
import { db, isUniqueViolation, notify, transaction } from "../db.js";
import { fail } from "../errors.js";
import { route } from "../http.js";
import { sendMail } from "../mail.js";
import { normalEmail } from "./accounts.js";

/** Projects, collections, members and invitations. */

const COLLECTION_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const collectionJson = (row: { id: string; name: string; count: string | number }): JsonObject => ({ id: row.id, name: row.name, count: Number(row.count) });

export function collectionName(value: JsonValue | undefined, field: string): string {
  return typeof value === "string" && COLLECTION_NAME.test(value) ? value : fail("invalid_field", { field });
}

route("GET", "/api/projects", async (ctx) => {
  const user = await requireUser(ctx);
  const result = await db.query<{ id: string; name: string; role: Role }>(
    'SELECT p.id, p.name, m.role FROM projects p JOIN members m ON m.project_id = p.id WHERE m.user_id = $1 ORDER BY p.name COLLATE "C", p.id',
    [user.id],
  );
  return { status: 200, body: { projects: result.rows } };
});

route("POST", "/api/projects", async (ctx) => {
  const user = await requireUser(ctx);
  const body = ctx.object();
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  if (name.length < 1 || name.length > 80) fail("invalid_field", { field: "name" });
  const first = collectionName(body["collection"], "collection");
  try {
    const created = await transaction(async (client) => {
      const project = (await client.query<{ id: string }>("INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id", [name, user.id])).rows[0] as { id: string };
      await client.query("INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, 'owner')", [project.id, user.id]);
      const collection = (await client.query<{ id: string }>("INSERT INTO collections (project_id, name) VALUES ($1, $2) RETURNING id", [project.id, first])).rows[0] as { id: string };
      return { project: { id: project.id, name }, collection: { id: collection.id, name: first, count: 0 } };
    });
    return { status: 201, body: created };
  } catch (error) {
    // the unique key on (owner, name) refuses a second project with the same name
    return isUniqueViolation(error) ? fail("name_taken") : Promise.reject(error);
  }
});

route("GET", "/api/projects/:pid", async (ctx) => {
  const { project, role } = await projectAccess(await requireUser(ctx), ctx.params["pid"] as string);
  const owner = (await db.query<{ email: string; name: string }>("SELECT email, name FROM users WHERE id = $1", [project.ownerId])).rows[0];
  return { status: 200, body: { id: project.id, name: project.name, role, owner: { email: owner?.email ?? "", name: owner?.name ?? "" } } };
});

route("DELETE", "/api/projects/:pid", async (ctx) => {
  const { project, role } = await projectAccess(await requireUser(ctx), ctx.params["pid"] as string);
  requireOwner(role);
  await db.query("DELETE FROM projects WHERE id = $1", [project.id]);
  return { status: 204 };
});

const memberJson = (row: { user_id: string; email: string; name: string; role: string }): JsonObject => ({ user_id: row.user_id, email: row.email, name: row.name, role: row.role });

route("GET", "/api/projects/:pid/members", async (ctx) => {
  const { project, role } = await projectAccess(await requireUser(ctx), ctx.params["pid"] as string);
  const members = await db.query<{ user_id: string; email: string; name: string; role: string }>(
    `SELECT u.id AS user_id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.project_id = $1 ORDER BY (m.role = 'owner') DESC, u.email COLLATE "C"`,
    [project.id],
  );
  const invitations =
    role === "owner"
      ? await db.query<{ id: string; email: string; role: string; state: string }>(
          `SELECT id, email, role, state FROM invitations WHERE project_id = $1 AND state = 'pending' ORDER BY created_at, id`,
          [project.id],
        )
      : { rows: [] };
  return { status: 200, body: { members: members.rows.map(memberJson), invitations: invitations.rows } };
});

async function targetMember(projectId: string, userId: string): Promise<{ user_id: string; email: string; name: string; role: Role }> {
  if (!isUuid(userId)) return fail("not_found");
  const result = await db.query<{ user_id: string; email: string; name: string; role: Role }>(
    "SELECT u.id AS user_id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 AND m.user_id = $2",
    [projectId, userId],
  );
  return result.rows[0] ?? fail("not_found");
}

route("PATCH", "/api/projects/:pid/members/:uid", async (ctx) => {
  const { project, role } = await projectAccess(await requireUser(ctx), ctx.params["pid"] as string);
  requireOwner(role);
  const member = await targetMember(project.id, ctx.params["uid"] as string);
  if (member.role === "owner") fail("owner_role_fixed");
  const next = ctx.object()["role"];
  if (next !== "editor" && next !== "reader") fail("invalid_field", { field: "role" });
  await db.query("UPDATE members SET role = $3 WHERE project_id = $1 AND user_id = $2", [project.id, member.user_id, next]);
  await notify(db, `r:${project.id}:${member.user_id}`);
  return { status: 200, body: memberJson({ ...member, role: next }) };
});

route("DELETE", "/api/projects/:pid/members/:uid", async (ctx) => {
  const { project, role } = await projectAccess(await requireUser(ctx), ctx.params["pid"] as string);
  requireOwner(role);
  const member = await targetMember(project.id, ctx.params["uid"] as string);
  if (member.role === "owner") fail("owner_role_fixed");
  await db.query("DELETE FROM members WHERE project_id = $1 AND user_id = $2", [project.id, member.user_id]);
  await notify(db, `r:${project.id}:${member.user_id}`);
  return { status: 204 };
});

route("POST", "/api/projects/:pid/invitations", async (ctx) => {
  const user = await requireUser(ctx);
  const { project, role } = await projectAccess(user, ctx.params["pid"] as string);
  requireOwner(role);
  const body = ctx.object();
  const email = normalEmail(body["email"]);
  if (email === null) fail("invalid_field", { field: "email" });
  const member = await db.query("SELECT 1 FROM members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 AND u.email = $2", [project.id, email]);
  if (member.rowCount) fail("already_member");
  const pending = await db.query("SELECT 1 FROM invitations WHERE project_id = $1 AND email = $2 AND state = 'pending'", [project.id, email]);
  if (pending.rowCount) fail("already_invited");
  const invited = body["role"];
  if (invited !== "editor" && invited !== "reader") fail("invalid_field", { field: "role" });
  let created: { id: string };
  try {
    created = (await db.query<{ id: string }>("INSERT INTO invitations (project_id, email, role, inviter_id) VALUES ($1, $2, $3, $4) RETURNING id", [project.id, email, invited, user.id])).rows[0] as { id: string };
  } catch (error) {
    if (isUniqueViolation(error)) return fail("already_invited");
    throw error;
  }
  const lines = `${user.name} invited you to ${project.name} as ${invited}.\n\nOpen ${config.publicUrl}/invites to accept.\n`;
  await sendMail(email, `You're invited to ${project.name} on Jarful`, lines).catch((error: Error) => console.error("mail:", error.message));
  return { status: 201, body: { invitation: { id: created.id, email, role: invited, state: "pending" } } };
});

route("DELETE", "/api/projects/:pid/invitations/:iid", async (ctx) => {
  const { project, role } = await projectAccess(await requireUser(ctx), ctx.params["pid"] as string);
  requireOwner(role);
  const id = ctx.params["iid"] as string;
  const found = isUuid(id) ? (await db.query<{ id: string; email: string; role: string; state: string }>("SELECT id, email, role, state FROM invitations WHERE id = $1 AND project_id = $2", [id, project.id])).rows[0] : undefined;
  if (!found) return fail("not_found");
  if (found.state !== "pending") return fail("invitation_closed");
  const revoked = await db.query("UPDATE invitations SET state = 'revoked' WHERE id = $1 AND state = 'pending'", [id]);
  if (revoked.rowCount === 0) return fail("invitation_closed");
  return { status: 200, body: { invitation: { ...found, state: "revoked" } } };
});

route("GET", "/api/invitations", async (ctx) => {
  const user = await requireUser(ctx);
  const result = await db.query<{ id: string; project_id: string; project_name: string; role: string; inviter_name: string }>(
    `SELECT i.id, p.id AS project_id, p.name AS project_name, i.role, u.name AS inviter_name
     FROM invitations i JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = i.inviter_id
     WHERE i.email = $1 AND i.state = 'pending' ORDER BY i.created_at, i.id`,
    [user.email],
  );
  const invitations = result.rows.map((row) => ({ id: row.id, project: { id: row.project_id, name: row.project_name }, role: row.role, inviter: { name: row.inviter_name } }));
  return { status: 200, body: { invitations } };
});

route("POST", "/api/invitations/:iid/accept", async (ctx) => {
  const user = await requireUser(ctx);
  const id = ctx.params["iid"] as string;
  const found = isUuid(id) ? (await db.query<{ project_id: string; email: string; role: string; state: string }>("SELECT project_id, email, role, state FROM invitations WHERE id = $1", [id])).rows[0] : undefined;
  if (!found || found.email !== user.email) return fail("not_found");
  if (found.state !== "pending") return fail("invitation_closed");
  await transaction(async (client) => {
    const claimed = await client.query("UPDATE invitations SET state = 'accepted' WHERE id = $1 AND state = 'pending'", [id]);
    if (claimed.rowCount === 0) return fail("invitation_closed");
    await client.query("INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [found.project_id, user.id, found.role]);
  });
  return { status: 200, body: { project_id: found.project_id } };
});

route("GET", "/api/projects/:pid/collections", async (ctx) => {
  const { project } = await projectAccess(await requireUser(ctx), ctx.params["pid"] as string);
  const result = await db.query<{ id: string; name: string; count: string }>(
    `SELECT c.id, c.name, (SELECT count(*) FROM documents d WHERE d.collection_id = c.id) AS count
     FROM collections c WHERE c.project_id = $1 ORDER BY c.name COLLATE "C"`,
    [project.id],
  );
  return { status: 200, body: { collections: result.rows.map(collectionJson) } };
});

route("POST", "/api/projects/:pid/collections", async (ctx) => {
  const { project, role } = await projectAccess(await requireUser(ctx), ctx.params["pid"] as string);
  requireOwner(role);
  const name = collectionName(ctx.object()["name"], "name");
  try {
    const created = (await db.query<{ id: string }>("INSERT INTO collections (project_id, name) VALUES ($1, $2) RETURNING id", [project.id, name])).rows[0] as { id: string };
    return { status: 201, body: { collection: collectionJson({ id: created.id, name, count: 0 }) } };
  } catch (error) {
    return isUniqueViolation(error) ? fail("name_taken") : Promise.reject(error);
  }
});

route("GET", "/api/projects/:pid/collections/:cid", async (ctx) => {
  const { collection } = await collectionAccess(await requireUser(ctx), ctx.params["pid"] as string, ctx.params["cid"] as string);
  const count = Number((await db.query<{ n: string }>("SELECT count(*) AS n FROM documents WHERE collection_id = $1", [collection.id])).rows[0]?.n ?? 0);
  return { status: 200, body: { id: collection.id, name: collection.name, count, sequence: collection.sequence, validator: collection.validator } };
});

route("DELETE", "/api/projects/:pid/collections/:cid", async (ctx) => {
  const { collection, role } = await collectionAccess(await requireUser(ctx), ctx.params["pid"] as string, ctx.params["cid"] as string);
  requireOwner(role);
  await db.query("DELETE FROM collections WHERE id = $1", [collection.id]);
  return { status: 204 };
});
