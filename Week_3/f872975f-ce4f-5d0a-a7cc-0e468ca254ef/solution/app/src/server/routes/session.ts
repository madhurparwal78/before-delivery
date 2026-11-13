// Sign-in with seeded email and password into a server-side session.
import { randomBytes } from "node:crypto";
import type { User } from "../../shared/api";
import { one, passwordMatches, pool } from "../db";
import { ApiError, Fields, isObject, ok, requireUser, route, SESSION_COOKIE } from "../http";

const cookie = (value: string, maxAge: number): string =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

route("POST", "/api/session", async ({ body }) => {
  const fields = new Fields();
  const email = isObject(body) && typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : null;
  const password = isObject(body) && typeof body["password"] === "string" ? body["password"] : null;
  if (email === null) fields.add("email", "Enter your email.");
  if (password === null) fields.add("password", "Enter your password.");
  fields.throwIfAny();
  const row = await one<User & { password_hash: string }>(pool,
    "SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = $1", [email]);
  if (row === undefined || password === null || !(await passwordMatches(password, row.password_hash))) {
    throw new ApiError("invalid_credentials");
  }
  const token = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, now())", [token, row.id]);
  const user: User = { id: row.id, name: row.name, email: row.email, role: row.role };
  return { status: 200, body: { user }, cookie: cookie(token, 60 * 60 * 24 * 14) };
});

route("GET", "/api/session", async (ctx) => ok({ user: requireUser(ctx) }));

route("DELETE", "/api/session", async (ctx) => {
  requireUser(ctx);
  await pool.query("DELETE FROM sessions WHERE token = $1", [ctx.sessionToken]);
  return { status: 204, cookie: cookie("", 0) };
});
