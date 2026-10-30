import type { Role } from "../../shared/api.js";
import { db } from "../db.js";
import { clearedSessionCookie, endSession, passwordMatches, sessionCookie, startSession, toUser } from "../http/auth.js";
import { ApiError } from "../http/errors.js";
import { ANY, member, open, type Router } from "../http/router.js";

export function sessionRoutes(router: Router): void {
  router.add("/api/health", { GET: open({ handle: async () => ({ status: 200, json: { status: "ok" } }) }) });

  router.add("/api/session", {
    POST: open({
      handle: async (ctx) => {
        const email = typeof ctx.body.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
        const password = typeof ctx.body.password === "string" ? ctx.body.password : "";
        const [row] = await db.query<{ id: string; workspace_id: string; name: string; email: string; role: Role; password_hash: string }>(
          "SELECT id, workspace_id, name, email, role, password_hash FROM members WHERE lower(email) = $1",
          [email],
        );
        if (!row || !(await passwordMatches(password, row.password_hash))) {
          throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
        }
        const token = await startSession(db, row.id);
        return {
          status: 200,
          json: { user: toUser({ ...row, workspaceId: row.workspace_id }) },
          headers: { "Set-Cookie": sessionCookie(token) },
        };
      },
    }),
    DELETE: member({
      roles: ANY,
      handle: async (ctx) => {
        await endSession(ctx.session.tokenHash);
        return { status: 204, headers: { "Set-Cookie": clearedSessionCookie } };
      },
    }),
  });

  router.add("/api/me", {
    GET: member({
      roles: ANY,
      handle: async (ctx) => ({ status: 200, json: { user: toUser(ctx.session.member), workspace: ctx.session.workspace } }),
    }),
  });
}
