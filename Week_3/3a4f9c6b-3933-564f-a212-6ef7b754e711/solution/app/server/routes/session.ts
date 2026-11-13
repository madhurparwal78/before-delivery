// Sessions and the project list.
import type { SessionBody } from "../../shared/api.js";
import { sessionUser, signIn, signOut, type User } from "../auth.js";
import { pool } from "../db.js";
import { invalid } from "../errors.js";
import { body, json, type Ctx, type Reply } from "../http.js";
import { isRecord } from "../validate.js";

async function sessionBody(user: User): Promise<SessionBody> {
  const { rows } = await pool.query<{ project: string; role: SessionBody["memberships"][number]["role"] }>(
    "SELECT p.slug AS project, m.role FROM memberships m JOIN projects p ON p.id = m.project_id WHERE m.user_id = $1 ORDER BY p.name",
    [user.id]);
  return { user: { email: user.email, name: user.name }, memberships: rows };
}

export async function createSession(ctx: Ctx): Promise<Reply> {
  const input = body(ctx);
  if (!isRecord(input) || typeof input.email !== "string" || typeof input.password !== "string") {
    throw invalid({ email: "Enter your email and password." });
  }
  const { user, cookie } = await signIn(pool, input.email, input.password, ctx.now);
  return json(200, await sessionBody(user), { "Set-Cookie": cookie });
}

export async function readSession(ctx: Ctx): Promise<Reply> {
  return json(200, await sessionBody(await sessionUser(pool, ctx)));
}

export async function deleteSession(ctx: Ctx): Promise<Reply> {
  await sessionUser(pool, ctx);
  return json(204, undefined, { "Set-Cookie": await signOut(pool, ctx) });
}

export async function listProjects(ctx: Ctx): Promise<Reply> {
  const user = await sessionUser(pool, ctx);
  const { rows } = await pool.query(
    "SELECT p.slug, p.name, m.role FROM memberships m JOIN projects p ON p.id = m.project_id WHERE m.user_id = $1 ORDER BY p.name",
    [user.id]);
  return json(200, { projects: rows });
}
