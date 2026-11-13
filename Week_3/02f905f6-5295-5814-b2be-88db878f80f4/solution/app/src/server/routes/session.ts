// Sign-in, sign-out, the signed-in user and the clay list.
import type { Clay } from "../../shared/api";
import { clearedCookie, createSession, endSession, passwordMatches, userOut, type UserRow } from "../auth";
import { pool } from "../db";
import { fieldsOf, HttpError, type Route } from "../http";

export const sessionRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/session",
    auth: false,
    body: "json",
    handler: async (ctx) => {
      const { email, password } = fieldsOf(ctx.body);
      const refused = new HttpError(401, "bad_credentials", "Email or password is wrong.");
      if (typeof email !== "string" || typeof password !== "string") throw refused;
      const found = await pool.query<UserRow & { password_hash: string }>("SELECT * FROM users WHERE lower(email) = lower($1)", [
        email.trim(),
      ]);
      const row = found.rows[0];
      if (!row || !(await passwordMatches(password, row.password_hash))) throw refused;
      return { status: 200, body: { user: userOut(row) }, headers: { "Set-Cookie": await createSession(row.id) } };
    },
  },
  {
    method: "DELETE",
    path: "/api/session",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      await endSession(ctx.req);
      return { status: 204, headers: { "Set-Cookie": clearedCookie } };
    },
  },
  {
    method: "GET",
    path: "/api/me",
    auth: true,
    body: "none",
    handler: async (ctx) => ({ status: 200, body: ctx.user }),
  },
  {
    method: "GET",
    path: "/api/clays",
    auth: true,
    body: "none",
    handler: async () => {
      const clays = await pool.query<Clay>("SELECT id, name, max_cone FROM clays ORDER BY position");
      return { status: 200, body: clays.rows };
    },
  },
];
