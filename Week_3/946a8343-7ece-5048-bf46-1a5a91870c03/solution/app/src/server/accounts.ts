// Accounts and sessions (DP-03) and the health check (DP-01).
import { FieldErrors, badCredentials, usernameTaken, validation } from "./errors.ts";
import { CLEAR_SESSION_COOKIE, endSession, hashPassword, publicUser, sessionCookie, sessionToken, startSession, verifyPassword } from "./auth.ts";
import { db } from "./db.ts";
import { healthStatus, json, type Router } from "./http.ts";
import { now } from "./clock.ts";
import { hit } from "./ratelimit.ts";
import { config } from "./config.ts";
import { isTimeZone } from "../shared/zone.ts";
import type { UserRow } from "./access.ts";
import { isRecord } from "./json.ts";

const USERNAME = /^[a-z0-9_]{3,24}$/;
const USERNAME_MESSAGE = "Username must be 3 to 24 characters: a-z, 0-9 and _.";
const PASSWORD_MESSAGE = "Password must be at least 8 characters.";

async function createUser(username: string, password: string): Promise<UserRow> {
  const stored = await hashPassword(password);
  const created = await db.maybe<UserRow>(
    "INSERT INTO users (username, password, time_zone, created_at) VALUES ($1, $2, 'UTC', $3) ON CONFLICT (username) DO NOTHING RETURNING id, username, time_zone",
    [username, stored, now()],
  );
  if (created === undefined) throw usernameTaken();
  return created;
}

function credentials(body: unknown): { username: string; password: string } {
  const record = isRecord(body) ? body : {};
  const username = typeof record["username"] === "string" ? record["username"].toLowerCase() : "";
  const password = typeof record["password"] === "string" ? record["password"] : "";
  return { username, password };
}

export function registerAccountRoutes(router: Router): void {
  router.get("/api/health", async () => json(200, { status: await healthStatus() }), { auth: false });

  router.post(
    "/api/users",
    async (ctx) => {
      const { username, password } = credentials(ctx.body);
      const errors = new FieldErrors();
      if (!USERNAME.test(username)) errors.add("username", USERNAME_MESSAGE);
      if (password.length < 8) errors.add("password", PASSWORD_MESSAGE);
      errors.throwIfAny();
      const user = await createUser(username, password);
      const token = await startSession(db, user.id);
      return json(201, { user: publicUser(user) }, { "set-cookie": sessionCookie(token) });
    },
    { auth: false },
  );

  router.post(
    "/api/session",
    async (ctx) => {
      const { username, password } = credentials(ctx.body);
      await hit(`login:${username}`, config.loginRate);
      const row = await db.maybe<UserRow & { password: string | null }>("SELECT id, username, time_zone, password FROM users WHERE username = $1", [username]);
      const valid = await verifyPassword(password, row?.password ?? null);
      if (row === undefined || !valid) throw badCredentials();
      const token = await startSession(db, row.id);
      return json(200, { user: publicUser(row) }, { "set-cookie": sessionCookie(token) });
    },
    { auth: false },
  );

  router.delete(
    "/api/session",
    async (ctx) => {
      const token = sessionToken(ctx.req);
      if (token !== undefined) await endSession(token);
      return { status: 204, headers: { "set-cookie": CLEAR_SESSION_COOKIE } };
    },
    { auth: false },
  );

  router.get("/api/me", (ctx) => json(200, { user: publicUser(ctx.user) }));

  router.patch("/api/me", async (ctx) => {
    const record = isRecord(ctx.body) ? ctx.body : {};
    const zone = record["time_zone"];
    if (!isTimeZone(zone)) throw validation({ time_zone: `Unknown time zone ${typeof zone === "string" ? zone : ""}.` });
    const user = await db.one<UserRow>("UPDATE users SET time_zone = $2 WHERE id = $1 RETURNING id, username, time_zone", [ctx.user.id, zone]);
    return json(200, { user: publicUser(user) });
  });

  router.get("/api/me/groups", async (ctx) => {
    const groups = await db.q<{ id: number; path: string; name: string }>(
      `SELECT DISTINCT g.id, g.path, g.name FROM groups g
         JOIN group_members m ON m.user_id = $1
         JOIN groups root ON root.id = m.group_id
        WHERE g.path = root.path OR g.path LIKE root.path || '/%'
        ORDER BY g.path`,
      [ctx.user.id],
    );
    return json(200, { groups });
  });

  router.get("/api/me/projects", async (ctx) => {
    const projects = await db.q<{ id: number; path: string; name: string; visibility: string }>(
      `SELECT DISTINCT p.id, p.path, p.slug AS name, p.visibility FROM projects p
         JOIN groups g ON g.id = p.group_id
        WHERE EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1)
           OR EXISTS (SELECT 1 FROM group_members gm JOIN groups gg ON gg.id = gm.group_id
                       WHERE gm.user_id = $1 AND (g.path = gg.path OR g.path LIKE gg.path || '/%'))
        ORDER BY p.path`,
      [ctx.user.id],
    );
    return json(200, { projects });
  });
}

