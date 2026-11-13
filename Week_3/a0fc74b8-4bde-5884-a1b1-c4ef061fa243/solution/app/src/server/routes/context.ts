import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { pool } from "../db.js";
import { unauthenticated, badRequestBody } from "../errors.js";
import type { Actor } from "../domain/permissions.js";
import { sha256Hex } from "../util.js";
import type { Role } from "../../shared/types.js";
import { asBody, type Body } from "../domain/validate.js";

export const SESSION_COOKIE = "undersign_session";

export async function findActor(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const { rows } = await pool.query<{ id: string; team_id: string; email: string; name: string; role: Role }>(
    `SELECT u.id, u.team_id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [sha256Hex(token)],
  );
  const row = rows[0];
  return row ? { id: row.id, teamId: row.team_id, email: row.email, name: row.name, role: row.role } : null;
}

export async function requireActor(c: Context): Promise<Actor> {
  const actor = await findActor(getCookie(c, SESSION_COOKIE));
  if (!actor) throw unauthenticated();
  return actor;
}

export async function jsonBody(c: Context): Promise<Body> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  try {
    return asBody(JSON.parse(text));
  } catch {
    throw badRequestBody();
  }
}


