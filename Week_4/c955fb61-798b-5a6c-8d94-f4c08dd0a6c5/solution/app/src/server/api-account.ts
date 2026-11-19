import { pool, newId, inTransaction } from "./db";
import { clearedCookie, endSession, hashPassword, passwordMatches, projectAccess, roleIn, startSession } from "./auth";
import { publicConfig } from "./config";
import { ApiError, invalidField, notFound } from "./errors";
import { openRoute, route, setCookieHeader, type Reply } from "./http";
import { buildProject, loadProject } from "./model";
import { computeWorkload, workloadMonday } from "./workload";
import { requireWrite } from "./api-items";
import * as check from "./validate";
import type { Role, WorkspaceMembership } from "../shared/types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

openRoute("GET", "/api/health", async () => ({ status: 200, body: { status: "ok" } }));
openRoute("GET", "/api/config", async () => ({ status: 200, body: publicConfig() }));

openRoute("POST", "/api/signup", async ({ body }) => {
  const name = check.text(body, "name", 1, 80);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL.test(email)) throw invalidField("email");
  const password = body.password;
  if (typeof password !== "string" || [...password].length < 10) throw invalidField("password");
  const id = newId();
  const hash = await hashPassword(password);
  await inTransaction(async (tx) => {
    const created = await tx.query("INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING", [id, name, email.toLowerCase(), hash]);
    if (created.rowCount === 0) throw new ApiError(409, "email_taken");
    const workspaceId = newId();
    await tx.query("INSERT INTO workspaces (id, name) VALUES ($1, $2)", [workspaceId, `${name}'s workspace`]);
    await tx.query("INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [workspaceId, id]);
  });
  return { status: 201, body: { user: { id, name, email: email.toLowerCase() } }, headers: setCookieHeader(await startSession(id)) };
});

openRoute("POST", "/api/session", async ({ body }) => {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const found = await pool.query("SELECT id, name, email, password_hash FROM users WHERE email = $1", [email]);
  if (found.rowCount === 0 || !(await passwordMatches(password, found.rows[0].password_hash))) throw new ApiError(401, "invalid_credentials");
  const user = found.rows[0];
  return { status: 200, body: { user: { id: user.id, name: user.name, email: user.email } }, headers: setCookieHeader(await startSession(user.id)) };
});

route("DELETE", "/api/session", async ({ req }) => {
  await endSession(req);
  return { status: 204, headers: setCookieHeader(clearedCookie) };
});

async function workspacesOf(userId: string): Promise<WorkspaceMembership[]> {
  const found = await pool.query(
    "SELECT w.id, w.name, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.joined_order",
    [userId],
  );
  return found.rows.map((row) => ({ id: row.id, name: row.name, role: row.role as Role }));
}

route("GET", "/api/me", async ({ person }) => ({ status: 200, body: { user: person, workspaces: await workspacesOf(person.id) } }));

route("GET", "/api/projects", async ({ person }) => {
  const found = await pool.query(
    `SELECT p.id, p.name, w.id AS workspace_id, w.name AS workspace_name FROM projects p
       JOIN workspaces w ON w.id = p.workspace_id JOIN members m ON m.workspace_id = w.id WHERE m.user_id = $1`,
    [person.id],
  );
  const projects = await Promise.all(
    found.rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      workspace: { id: row.workspace_id, name: row.workspace_name },
      finish: buildProject(await loadProject(pool, row.id)).finish,
    })),
  );
  return { status: 200, body: { projects: projects.sort((a, b) => a.name.localeCompare(b.name)) } };
});

route("POST", "/api/projects", async ({ person, body }) => {
  const workspaceId = typeof body.workspace === "string" ? body.workspace : "";
  const role = await roleIn(workspaceId, person.id);
  if (!role) throw notFound();
  requireWrite({ role });
  const name = check.text(body, "name", 1, 80);
  const id = newId();
  await pool.query("INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)", [id, workspaceId, name]);
  return { status: 201, body: { project: buildProject(await loadProject(pool, id)) } };
});

route("GET", "/api/projects/:id", async ({ person, params }) => {
  const access = await projectAccess(person.id, params.id);
  if (!access) throw notFound();
  const loaded = await loadProject(pool, access.projectId);
  return { status: 200, body: buildProject(loaded), headers: { "x-project-rev": String(loaded.rev) } } satisfies Reply;
});

route("GET", "/api/workspaces/:id/workload", async ({ person, params, query }) => {
  if (!(await roleIn(params.id, person.id))) throw notFound();
  return { status: 200, body: await computeWorkload(params.id, workloadMonday(query.get("from"))) };
});
