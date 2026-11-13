import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { pool } from "../db.js";
import { ApiError } from "../errors.js";
import { newToken, passwordMatches, sha256Hex } from "../util.js";
import type { SessionJson, Role } from "../../shared/types.js";
import { SESSION_COOKIE, jsonBody, requireActor } from "./context.js";

const MONTH_SECONDS = 60 * 60 * 24 * 30;

async function sessionJson(userId: string): Promise<SessionJson> {
  const { rows } = await pool.query<{ id: string; email: string; name: string; role: Role; team_id: string; team_name: string }>(
    "SELECT u.id, u.email, u.name, u.role, t.id AS team_id, t.name AS team_name FROM users u JOIN teams t ON t.id = u.team_id WHERE u.id = $1",
    [userId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(401, { error: "unauthenticated" });
  return { user: { id: row.id, email: row.email, name: row.name }, team: { id: row.team_id, name: row.team_name }, role: row.role };
}

export const sessionRoutes = new Hono();

sessionRoutes.post("/", async (c) => {
  const body = await jsonBody(c);
  const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
  const password = typeof body["password"] === "string" ? body["password"] : "";
  const { rows } = await pool.query<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = $1", [email]);
  const user = rows[0];
  const matches = user ? await passwordMatches(password, user.password_hash) : false;
  if (!user || !matches) throw new ApiError(401, { error: "invalid_credentials" });
  const token = newToken();
  await pool.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [sha256Hex(token), user.id]);
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: MONTH_SECONDS });
  return c.json(await sessionJson(user.id));
});

sessionRoutes.get("/", async (c) => {
  const actor = await requireActor(c);
  return c.json(await sessionJson(actor.id));
});

sessionRoutes.delete("/", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256Hex(token)]);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});
