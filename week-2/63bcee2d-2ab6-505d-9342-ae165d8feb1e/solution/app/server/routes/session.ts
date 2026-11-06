import { endSession, endedSessionCookie, memberByEmail, memberRef, passwordMatches, startSession } from "../auth.js";
import { pool } from "../db.js";
import { invalidCredentials } from "../http/errors.js";
import { noContent, ok, type Route } from "../http/router.js";
import { record } from "../http/validate.js";

export const routes: Route[] = [
  {
    method: "POST", path: "/api/session", auth: "public",
    handler: async (ctx) => {
      const body = record(ctx.json());
      const email = typeof body.email === "string" ? body.email : "";
      const password = typeof body.password === "string" ? body.password : "";
      const member = email ? await memberByEmail(pool, email) : undefined;
      if (!member || member.status !== "active" || !(await passwordMatches(password, member.passwordHash))) {
        throw invalidCredentials();
      }
      return ok({ member: memberRef(member) }, 200, { "Set-Cookie": await startSession(pool, member.id) });
    },
  },
  {
    method: "GET", path: "/api/session", auth: "member",
    handler: async (ctx) => ok({ member: { ...memberRef(ctx.me), email: ctx.me.email } }),
  },
  {
    method: "DELETE", path: "/api/session", auth: "member",
    handler: async (ctx) => {
      if (ctx.sessionToken) await endSession(pool, ctx.sessionToken);
      return noContent({ "Set-Cookie": endedSessionCookie });
    },
  },
];
