import { randomBytes } from "node:crypto";
import { now } from "../clock.js";
import { one, pool } from "../db.js";
import { ApiError, FIELD, invalid, type FieldErrors } from "../errors.js";
import { closeSessionStreams } from "../events.js";
import { CLEARED_COOKIE, empty, hashToken, json, publicRoute, route, sessionCookie, type Body } from "../http.js";
import { verifyPassword } from "../domain/passwords.js";
import { acceptInvite, deactivatePerson, inviteDetails, invitePerson, workspaceMembers } from "../domain/people.js";
import { projectUser, type UserRow } from "../domain/projection.js";

export function objectBody(body: Body): Record<string, unknown> {
  if (body.kind === "json" && typeof body.value === "object" && body.value !== null && !Array.isArray(body.value)) {
    return body.value as Record<string, unknown>;
  }
  throw invalid({});
}

type SignedIn = UserRow & { workspace_id: string; workspace_name: string; time_zone: string };

async function startSession(userId: string): Promise<{ cookie: string; body: { user: unknown; workspace: unknown } }> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)", [hashToken(token), userId, now()]);
  const row = await one<SignedIn>(
    pool,
    `SELECT u.id, u.name, u.handle, u.email, u.role, u.status, w.id AS workspace_id, w.name AS workspace_name, w.time_zone
       FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE u.id = $1`,
    [userId],
  );
  if (!row) throw new ApiError("internal_error");
  const { workspace_id, workspace_name, time_zone, ...user } = row;
  return { cookie: sessionCookie(token), body: { user: projectUser(user, user), workspace: { id: workspace_id, name: workspace_name, time_zone } } };
}

export function registerPeopleRoutes(): void {
  publicRoute("POST", "/api/session", async ({ body }) => {
    const value = objectBody(body);
    const email = typeof value.email === "string" ? value.email.trim() : "";
    const password = typeof value.password === "string" ? value.password : "";
    const errors: FieldErrors = {};
    if (email === "") errors.email = FIELD.email;
    if (password === "") errors.password = FIELD.passwordSignIn;
    if (Object.keys(errors).length > 0) throw invalid(errors);
    const user = await one<{ id: string; password_hash: string | null }>(
      pool,
      "SELECT id, password_hash FROM users WHERE lower(email) = lower($1) AND status = 'active'",
      [email],
    );
    if (!user || !(await verifyPassword(password, user.password_hash))) throw new ApiError("invalid_credentials");
    const session = await startSession(user.id);
    return json(200, session.body, { "Set-Cookie": session.cookie });
  });

  route("DELETE", "/api/session", async ({ viewer }) => {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [viewer.sessionHash]);
    closeSessionStreams(viewer.sessionHash);
    return empty(204, { "Set-Cookie": CLEARED_COOKIE });
  });

  route("GET", "/api/me", async ({ viewer }) => {
    const user: UserRow = { id: viewer.id, name: viewer.name, handle: viewer.handle, email: viewer.email, role: viewer.role, status: viewer.status };
    return json(200, { user: projectUser(viewer, user), workspace: viewer.workspace });
  });

  route("GET", "/api/workspace/members", async ({ viewer, url }) => json(200, { members: await workspaceMembers(viewer, url.searchParams.get("q")) }));

  route("POST", "/api/workspace/members", async ({ viewer, body }) => json(201, await invitePerson(viewer, objectBody(body))));

  route("DELETE", "/api/workspace/members/:userId", async ({ viewer, params }) => json(200, { member: await deactivatePerson(viewer, params.userId ?? "") }));

  publicRoute("GET", "/api/invites/:token", async ({ params }) => json(200, await inviteDetails(params.token ?? "")));

  publicRoute("POST", "/api/invites/:token/accept", async ({ params, body }) => {
    const userId = await acceptInvite(params.token ?? "", objectBody(body));
    const session = await startSession(userId);
    return json(200, session.body, { "Set-Cookie": session.cookie });
  });
}
