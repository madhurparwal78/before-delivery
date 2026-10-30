import type { Route, Ctx } from "../http.js";
import { cryptoRandom } from "../http.js";
import { query, withTransaction } from "../db.js";
import { ApiError, errors, validationError } from "../errors.js";
import { hashPassword, verifyPassword } from "../config.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function userJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name),
    role: String(row.role),
    organisation_id: row.organisation_id === null || row.organisation_id === undefined ? null : String(row.organisation_id),
  };
}

async function createSession(userId: number): Promise<string> {
  const id = cryptoRandom();
  await query("insert into login_sessions (id, user_id) values ($1,$2)", [id, userId]);
  return id;
}

export function authRoutes(): Route[] {
  const register: Route = {
    method: "POST",
    pattern: "/api/auth/register",
    roles: "public",
    bodyLimit: "json",
    async handler(ctx: Ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const problems: Record<string, string> = {};
      if (name.length === 0 || name.length > 200) problems.name = "invalid";
      if (!EMAIL_RE.test(email) || email.length > 200) problems.email = "invalid";
      if (password.length < 10 || password.length > 200) problems.password = "invalid";
      if (Object.keys(problems).length > 0) throw validationError(problems);
      const existing = await query("select 1 from users where email = $1", [email]);
      if (existing.rows.length > 0) throw errors.conflict("email_taken");
      const created = await withTransaction(async (tx) => {
        const res = await tx.query(
          "insert into users (name, email, password_hash, role, organisation_id) values ($1,$2,$3,'visitor',null) returning *",
          [name, email, hashPassword(password)],
        );
        return res.rows[0];
      });
      const session = await createSession(Number(created.id));
      return {
        status: 201,
        body: { user: userJson(created) },
        headers: { "Set-Cookie": ctx.app.sessionCookie(session) },
      };
    },
  };

  const signin: Route = {
    method: "POST",
    pattern: "/api/auth/signin",
    roles: "public",
    bodyLimit: "json",
    async handler(ctx: Ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const found = await query("select * from users where email = $1", [email]);
      const row = found.rows[0];
      if (!row || !verifyPassword(password, String(row.password_hash))) {
        throw new ApiError(401, { error: "invalid_credentials" });
      }
      const session = await createSession(Number(row.id));
      return {
        status: 200,
        body: { user: userJson(row) },
        headers: { "Set-Cookie": ctx.app.sessionCookie(session) },
      };
    },
  };

  const signout: Route = {
    method: "POST",
    pattern: "/api/auth/signout",
    roles: "public",
    bodyLimit: "none",
    async handler(ctx: Ctx) {
      const sessionId = ctx.app.parseSessionCookie(ctx.cookies);
      if (sessionId) {
        await query("delete from login_sessions where id = $1", [sessionId]);
      }
      return {
        status: 204,
        headers: { "Set-Cookie": ctx.app.clearSessionCookie() },
      };
    },
  };

  const me: Route = {
    method: "GET",
    pattern: "/api/me",
    roles: "public",
    bodyLimit: "none",
    async handler(ctx: Ctx) {
      if (!ctx.user) throw errors.unauthenticated();
      const found = await query("select * from users where id = $1", [ctx.user.id]);
      return { status: 200, body: { user: userJson(found.rows[0]) } };
    },
  };

  return [register, signin, signout, me];
}
