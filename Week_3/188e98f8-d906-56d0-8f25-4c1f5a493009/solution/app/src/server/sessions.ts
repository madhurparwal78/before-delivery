import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { SessionInfo } from "../shared/api-types";
import type { Role } from "../shared/roles";
import { normalizeText } from "../shared/text";
import type { Ctx, Reply, Session } from "./context";
import { json } from "./context";
import { pool } from "./db";
import { Fields, badCode } from "./errors";
import { asObject } from "./validate";

const COOKIE = "rk_desk";

function sessionToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

export async function findSession(req: IncomingMessage): Promise<Session | null> {
  const token = sessionToken(req);
  if (token === null || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const result = await pool.query<{ role: Role; team_id: number | null }>(
    "SELECT role, team_id FROM sessions WHERE token = $1",
    [token],
  );
  const row = result.rows[0];
  return row === undefined ? null : { token, role: row.role, teamId: row.team_id };
}

async function describe(role: Role, teamId: number | null): Promise<SessionInfo> {
  if (teamId === null) return { role, team_id: null, team_name: null };
  const team = await pool.query<{ name: string }>("SELECT name FROM teams WHERE id = $1", [teamId]);
  return { role, team_id: teamId, team_name: team.rows[0]?.name ?? null };
}

export async function signIn(ctx: Ctx): Promise<Reply> {
  const raw = asObject(ctx.body)["code"];
  const fields = new Fields();
  if (raw === undefined || raw === null) fields.set("code", "required");
  else if (typeof raw !== "string") fields.set("code", "invalid");
  else if (normalizeText(raw) === "") fields.set("code", "required");
  fields.assertEmpty();
  const code = normalizeText(raw as string);
  const found = await pool.query<{ role: Role; team_id: number | null }>(
    "SELECT role, team_id FROM desk_codes WHERE code = $1",
    [code],
  );
  const desk = found.rows[0];
  if (desk === undefined) throw badCode();
  const token = randomBytes(24).toString("base64url");
  await pool.query("INSERT INTO sessions (token, role, team_id) VALUES ($1, $2, $3)", [token, desk.role, desk.team_id]);
  return json(201, await describe(desk.role, desk.team_id), {
    "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`,
  });
}

export async function currentSession(ctx: Ctx): Promise<Reply> {
  const session = ctx.session as Session;
  return json(200, await describe(session.role, session.teamId));
}

export async function signOut(ctx: Ctx): Promise<Reply> {
  const session = ctx.session as Session;
  await pool.query("DELETE FROM sessions WHERE token = $1", [session.token]);
  return { status: 204, headers: { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
}
