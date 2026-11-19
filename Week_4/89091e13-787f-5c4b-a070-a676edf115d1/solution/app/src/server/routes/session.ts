import { Hono } from "hono";
import { clearedSessionCookie, createSession, hashPassword, passwordMatches, sessionCookie, cookieValue, SESSION_COOKIE } from "../auth.ts";
import { clockNow } from "../clock.ts";
import { exclusive, maybeOne, pool, rows, run, transaction } from "../db.ts";
import { HttpError, invalid } from "../errors.ts";
import { storageReachable } from "../storage.ts";
import { jsonBody, requireUser } from "./context.ts";
import type { Me } from "../../shared/api.ts";

const SIGN_IN_ERROR = "Email or password is incorrect.";
const INVITE_GONE = "This invite link has already been used or has expired.";

async function meOf(userId: string): Promise<Me | undefined> {
  const user = await maybeOne<Me["user"]>(pool, "SELECT id, name, email FROM users WHERE id = $1", [userId]);
  if (!user) return undefined;
  const workspaces = await rows<Me["workspaces"][number]>(
    pool,
    `SELECT w.id, w.name, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = $1 ORDER BY m.joined_at, m.seq`,
    [userId],
  );
  return { user, workspaces };
}

interface InviteRow {
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: "developer" | "viewer";
  existingAccount: boolean;
}

/** An invite that is unused and not yet at its expiry instant (the instant itself is refused). */
async function openInvite(token: string): Promise<InviteRow> {
  const invite = !/^[0-9a-f]+$/.test(token) ? undefined : await maybeOne<InviteRow>(
    pool,
    `SELECT i.workspace_id AS "workspaceId", w.name AS "workspaceName", i.email, i.role,
            EXISTS (SELECT 1 FROM users u WHERE u.email = i.email) AS "existingAccount"
     FROM invites i JOIN workspaces w ON w.id = i.workspace_id
     WHERE i.token = $1 AND i.used_at IS NULL AND i.expires_at > $2`,
    [token, clockNow()],
  );
  if (!invite) throw new HttpError(410, { error: INVITE_GONE });
  return invite;
}

export const sessionRoutes = new Hono();

sessionRoutes.post("/session", async (c) => {
  const body = await jsonBody(c);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = await maybeOne<{ id: string; passwordHash: string }>(pool, 'SELECT id, password_hash AS "passwordHash" FROM users WHERE email = $1', [email]);
  if (!user || !passwordMatches(password, user.passwordHash)) throw new HttpError(401, { error: SIGN_IN_ERROR });
  const token = await createSession(pool, user.id);
  c.header("Set-Cookie", sessionCookie(token));
  return c.json(await meOf(user.id));
});

sessionRoutes.delete("/session", async (c) => {
  const token = cookieValue(c.req.header("cookie"), SESSION_COOKIE);
  if (token) await run(pool, "DELETE FROM sessions WHERE token = $1", [token]);
  c.header("Set-Cookie", clearedSessionCookie);
  return c.body(null, 204);
});

sessionRoutes.get("/me", async (c) => c.json(await meOf((await requireUser(c)).id)));

sessionRoutes.get("/invites/:token", async (c) => {
  const invite = await openInvite(c.req.param("token"));
  return c.json({ workspaceName: invite.workspaceName, email: invite.email, role: invite.role, existingAccount: invite.existingAccount });
});

sessionRoutes.post("/invites/:token/accept", async (c) => {
  const body = await jsonBody(c);
  return exclusive(async () => {
    const token = c.req.param("token");
    const invite = await openInvite(token);
    const password = typeof body.password === "string" ? body.password : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const existing = await maybeOne<{ id: string; passwordHash: string }>(pool, 'SELECT id, password_hash AS "passwordHash" FROM users WHERE email = $1', [invite.email]);
    if (existing) {
      if (!passwordMatches(password, existing.passwordHash)) throw new HttpError(401, { error: SIGN_IN_ERROR });
    } else {
      if (name === "") throw invalid("name", "Enter your name.");
      if (password.length < 8) throw invalid("password", "Password must be at least 8 characters.");
    }
    const sessionToken = await transaction(async (db) => {
      const userId =
        existing?.id ??
        (await maybeOne<{ id: string }>(db, "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id", [name, invite.email, hashPassword(password)]))?.id;
      await run(db, "INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [invite.workspaceId, userId, invite.role, clockNow()]);
      await run(db, "UPDATE invites SET used_at = $2 WHERE token = $1", [token, clockNow()]);
      return createSession(db, userId as string);
    });
    c.header("Set-Cookie", sessionCookie(sessionToken));
    return c.json({ workspaceId: invite.workspaceId });
  });
});

sessionRoutes.get("/health", (c) => c.json({ status: storageReachable() ? "ok" : "unavailable" }));
