import type pg from "pg";
import { one, pool } from "../db.js";
import { loadCalendar } from "../domain/calendar.js";
import { membershipOf } from "../domain/membership.js";
import { newSessionToken, passwordMatches, tokenHash } from "../domain/session.js";
import { ApiError, readCookie, route, SESSION_COOKIE, type Reply, type User } from "../http/pipeline.js";
import { serviceStatus } from "../providers/status.js";
import { membershipView } from "../views.js";
import { syncMembership } from "../workers.js";

export async function startSession(db: pg.PoolClient | typeof pool, userId: number): Promise<string> {
  const token = newSessionToken();
  await db.query(`INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)`, [tokenHash(token), userId]);
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

const SIGN_IN_REFUSED = "Email or password is incorrect.";

export const sessionRoutes = [
  route({
    method: "POST",
    path: "/api/session",
    access: "anyone",
    body: "json",
    handle: async (ctx): Promise<Reply> => {
      const email = typeof ctx.json?.email === "string" ? ctx.json.email.trim().toLowerCase() : "";
      const password = typeof ctx.json?.password === "string" ? ctx.json.password : "";
      const user = await one<User & { password_hash: string }>(
        pool,
        `SELECT id, name, email, role, password_hash FROM users WHERE email = $1`,
        [email],
      );
      if (!user || !(await passwordMatches(password, user.password_hash))) throw new ApiError(401, SIGN_IN_REFUSED);
      const { password_hash: _hash, ...shown } = user;
      return { status: 200, body: { user: shown }, headers: { "Set-Cookie": await startSession(pool, user.id) } };
    },
  }),
  route({
    method: "DELETE",
    path: "/api/session",
    access: "anyone",
    body: "none",
    handle: async (ctx): Promise<Reply> => {
      const token = readCookie(ctx.req, SESSION_COOKIE);
      if (token) await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash(token)]);
      return { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` } };
    },
  }),
  route({
    method: "GET",
    path: "/api/me",
    access: "signed-in",
    body: "none",
    handle: async (ctx): Promise<Reply> => {
      const user = ctx.caller!;
      if (user.role !== "member") return { status: 200, body: { user, membership: null } };
      if ((await membershipOf(pool, user.id))?.status === "pending-payment") await syncMembership(user.id);
      const calendar = await loadCalendar(pool);
      return { status: 200, body: { user, membership: membershipView((await membershipOf(pool, user.id))!, calendar, ctx.now) } };
    },
  }),
  route({
    method: "GET",
    path: "/api/status",
    access: "anyone",
    body: "none",
    handle: async (): Promise<Reply> => ({ status: 200, body: serviceStatus() }),
  }),
];
