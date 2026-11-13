import type { Ctx } from "./core.js";
import type { Role } from "./domain.js";
import { newToken } from "./documents.js";

export const SESSION_COOKIE = "undersign_session";

export async function verifySession(ctx: Ctx, cookies: Record<string, string>): Promise<Ctx["actor"]> {
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const res = await ctx.pool.query(
    `SELECT u.id, u.team_id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token],
  );
  if (res.rowCount === 0 || res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    userId: row.id,
    teamId: row.team_id,
    role: row.role as Role,
    email: row.email,
    name: row.name,
  };
}

export async function createSession(ctx: Ctx, userId: string): Promise<{ token: string }> {
  const token = newToken();
  await ctx.pool.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
  return { token };
}

export async function destroySession(ctx: Ctx, token: string): Promise<void> {
  await ctx.pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}
