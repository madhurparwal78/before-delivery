// Sign-in, the profile, templates and the project list.
import type { ProjectSummary, Workspace } from "../shared/api.ts";
import { userShape } from "./access.ts";
import { clearedCookie, endSession, openSession, passwordMatches, sessionCookie, signedIn, SESSION_COOKIE, userByEmail, type UserRow } from "./auth.ts";
import { one, pool, query, transaction } from "./db.ts";
import { fail, noContent, ok, type Context, type Reply } from "./http.ts";
import { createProject } from "./projects.ts";
import { TEMPLATES, templateById } from "./templates.ts";
import { Fields, validDisplayName, validTitle } from "./validate.ts";

export async function signIn(ctx: Context): Promise<Reply> {
  const fields = new Fields(ctx.body, ["email", "password"]);
  const email = fields.string("email", "Email or password is incorrect.");
  const password = fields.string("password", "Email or password is incorrect.");
  fields.check();
  const user = await userByEmail(pool, email);
  if (!user || !(await passwordMatches(password, user.password_hash))) throw fail.invalidCredentials();
  const token = await openSession(pool, user.id);
  return ok({ user: userShape(user) }, 200, { "Set-Cookie": sessionCookie(token) });
}

export async function signOut(ctx: Context): Promise<Reply> {
  await signedIn(ctx);
  await endSession(pool, ctx.cookies[SESSION_COOKIE]);
  return { ...noContent(), headers: { "Set-Cookie": clearedCookie() } };
}

async function workspaceOf(userId: string): Promise<Workspace | null> {
  const row = await one<{ id: string; name: string; role: Workspace["role"] }>(
    pool,
    `SELECT w.id, w.name, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 ORDER BY m.role = 'owner' DESC, w.name LIMIT 1`,
    [userId],
  );
  return row ?? null;
}

export async function readMe(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  return ok({ user: userShape(user), workspace: await workspaceOf(user.id) });
}

/** Only the display name is ever written; handle and email never change. */
export async function updateMe(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const fields = new Fields(ctx.body, ["displayName"]);
  const displayName = fields.string("displayName", "Enter a display name of 1 to 80 characters.", validDisplayName);
  fields.check();
  const row = await one<UserRow>(pool, "UPDATE users SET display_name = $2 WHERE id = $1 RETURNING *", [user.id, displayName]);
  return ok({ user: userShape(row as UserRow) });
}

export async function readTemplates(ctx: Context): Promise<Reply> {
  await signedIn(ctx);
  return ok({ templates: TEMPLATES.map((template) => ({ id: template.id, name: template.name })) });
}

const summarySelect = `
  SELECT p.id, p.title, p.template, m.role, p.revision AS "projectRevision"
    FROM projects p JOIN memberships m ON m.project_id = p.id AND m.user_id = $1`;

export async function listProjects(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const projects = await query<ProjectSummary>(pool, `${summarySelect} ORDER BY p.title COLLATE "C", p.id`, [user.id]);
  return ok({ projects });
}

export async function newProject(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const workspace = await workspaceOf(user.id);
  if (workspace?.role !== "owner") throw fail.forbidden();
  const fields = new Fields(ctx.body, ["title", "template"]);
  const title = fields.string("title", "Enter a title of 1 to 120 characters.", validTitle);
  const template = templateById(fields.oneOf("template", TEMPLATES.map((t) => t.id), "Choose a published template."));
  fields.check();
  const projectId = await transaction((client) => createProject(client, workspace.id, title, template as NonNullable<typeof template>, user));
  const project = await one<ProjectSummary>(pool, `${summarySelect} WHERE p.id = $2`, [user.id, projectId]);
  return ok({ project }, 201);
}
