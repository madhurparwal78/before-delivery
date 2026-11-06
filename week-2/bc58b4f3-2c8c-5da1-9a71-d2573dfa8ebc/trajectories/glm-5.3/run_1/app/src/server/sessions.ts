import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ApiError } from "./errors";
import { sendJson } from "./httpio";
import { Ctx, Router } from "./router";
import { verifyPassword } from "./db";
import { Config } from "./config";
import { rememberOrgNames } from "./assignments";

export async function createSession(db: Pool, config: Config, email: string, password: string): Promise<{ token: string; user: Record<string, unknown> }> {
  const res = await db.query(
    `SELECT p.id, p.email, p.password_hash, p.name, p.role, p.initials, p.org_code, p.active,
            o.code AS org_code, o.name AS org_name
       FROM people p
       LEFT JOIN organisations o ON o.code = p.org_code
      WHERE lower(p.email) = lower($1)`,
    [email],
  );
  const row = res.rows[0] as
    | { id: number; email: string; password_hash: string; name: string; role: string; initials: string | null; org_code: string | null; org_name: string | null; active: boolean }
    | undefined;
  if (!row || !row.active || !verifyPassword(password, row.password_hash)) {
    throw new ApiError("invalid_credentials", "Email or password is wrong.");
  }
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO sessions (token, person_id, expires_at) VALUES ($1,$2, now() + ($3 || ' seconds')::interval)`,
    [token, row.id, config.sessionTtlSeconds],
  );
  return {
    token,
    user: {
      id: row.id,
      name: row.name,
      role: row.role,
      initials: row.initials,
      org: row.org_code ? { code: row.org_code, name: row.org_name } : null,
    },
  };
}

export async function sessionUser(db: Pool, token: string | undefined): Promise<SessionPerson | null> {
  if (!token) return null;
  const res = await db.query(
    `SELECT p.id, p.email, p.name, p.role, p.initials, p.org_code, p.active, s.expires_at,
            o.name AS org_name
       FROM sessions s
       JOIN people p ON p.id = s.person_id
       LEFT JOIN organisations o ON o.code = p.org_code
      WHERE s.token = $1`,
    [token],
  );
  const row = res.rows[0] as
    | { id: number; email: string; name: string; role: string; initials: string | null; org_code: string | null; org_name: string | null; active: boolean; expires_at: Date }
    | undefined;
  if (!row || !row.active || row.expires_at.getTime() < Date.now()) return null;
  if (row.org_code && row.org_name) rememberOrgNames([{ code: row.org_code, name: row.org_name }]);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    initials: row.initials,
    orgCode: row.org_code,
    sessionToken: token,
  };
}

export interface SessionPerson {
  id: number;
  email: string;
  name: string;
  role: string;
  initials: string | null;
  orgCode: string | null;
  sessionToken: string;
}

export function parseSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "teamseat_session") return rest.join("=");
  }
  return undefined;
}

export async function registerSessionRoutes(router: Router, db: Pool, config: Config): Promise<void> {
  router.add("POST", "/api/session", { body: "json", roles: "any", handler: async (ctx: Ctx) => {
    const body = (ctx.body?.json ?? {}) as { email?: unknown; password?: unknown };
    if (typeof body.email !== "string" || typeof body.password !== "string" || !body.email) {
      throw new ApiError("invalid_credentials", "Email or password is wrong.");
    }
    const session = await createSession(db, config, body.email, body.password);
    setSessionCookie(ctx, session.token, config);
    sendJson(ctx.res, 200, { user: session.user });
  }});

  router.add("DELETE", "/api/session", { roles: "any", handler: async (ctx: Ctx) => {
    if (ctx.session) {
      await db.query(`DELETE FROM sessions WHERE token = $1`, [ctx.session.sessionToken]);
    }
    clearSessionCookie(ctx);
    ctx.res.writeHead(204);
    ctx.res.end();
  }});

  router.add("GET", "/api/me", { roles: "any", handler: async (ctx: Ctx) => {
    const res = await db.query(
      `SELECT p.id, p.name, p.role, p.initials, o.code AS org_code, o.name AS org_name
         FROM people p LEFT JOIN organisations o ON o.code = p.org_code
        WHERE p.id = $1`,
      [ctx.session?.id],
    );
    const row = res.rows[0] as { id: number; name: string; role: string; initials: string | null; org_code: string | null; org_name: string | null } | undefined;
    sendJson(ctx.res, 200, {
      user: row
        ? { id: row.id, name: row.name, role: row.role, initials: row.initials, org: row.org_code ? { code: row.org_code, name: row.org_name } : null }
        : null,
    });
  }});
}

export function setSessionCookie(ctx: Ctx, token: string, config: Config): void {
  const cookie = `teamseat_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}`;
  ctx.res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(ctx: Ctx): void {
  ctx.res.setHeader("Set-Cookie", "teamseat_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}
