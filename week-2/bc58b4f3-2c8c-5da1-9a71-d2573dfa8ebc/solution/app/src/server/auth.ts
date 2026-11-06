import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { pool } from "./db.js";
import { ApiError, type Context, type Reply, type SignedInContext, openRoute, route } from "./http.js";
import { passwordMatches } from "./passwords.js";

const SESSION_COOKIE = "teamseat_session";

export type Role = "scheduler" | "org_admin" | "dispatcher" | "billing_lead" | "interpreter";

export interface Person {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  orgCode: string | null;
  orgName: string | null;
}

export interface Session {
  tokenHash: string;
  person: Person;
}

/** Initials are the first letter of the given name and of the family name, each with a full stop. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const given = parts[0] ?? "";
  const family = parts[parts.length - 1] ?? "";
  return `${given.charAt(0)}.${family.charAt(0)}.`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

interface PersonRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  org_code: string | null;
  org_name: string | null;
}

const PERSON_COLUMNS = `p.id, p.name, p.email, p.phone, p.role, p.org_code, o.name AS org_name`;

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    orgCode: row.org_code,
    orgName: row.org_name,
  };
}

export async function findSession(cookieHeader: string | undefined): Promise<Session | null> {
  const token = cookieValue(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const found = await pool.query<PersonRow>(
    `SELECT ${PERSON_COLUMNS} FROM sessions s
       JOIN people p ON p.id = s.person_id
       LEFT JOIN organisations o ON o.code = p.org_code
      WHERE s.token_hash = $1 AND s.expires_at > now() AND p.active`,
    [tokenHash],
  );
  const row = found.rows[0];
  return row ? { tokenHash, person: toPerson(row) } : null;
}

function userBody(person: Person): unknown {
  return {
    user: {
      id: person.id,
      name: person.name,
      role: person.role,
      initials: initialsOf(person.name),
      org: person.orgCode ? { code: person.orgCode, name: person.orgName } : null,
    },
  };
}

/** Throws `forbidden` unless the caller has one of the roles. */
export function requireRole(ctx: SignedInContext, ...roles: Role[]): Person {
  if (!roles.includes(ctx.session.person.role)) throw new ApiError("forbidden");
  return ctx.session.person;
}

async function signIn(ctx: Context): Promise<Reply> {
  const body = ctx.body as { email?: unknown; password?: unknown } | undefined;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const found = await pool.query<PersonRow & { password_hash: string }>(
    `SELECT ${PERSON_COLUMNS}, p.password_hash FROM people p
       LEFT JOIN organisations o ON o.code = p.org_code
      WHERE lower(p.email) = $1 AND p.active`,
    [email],
  );
  const row = found.rows[0];
  if (!row || !(await passwordMatches(password, row.password_hash))) throw new ApiError("invalid_credentials");
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions (token_hash, person_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
    [hashToken(token), row.id, config.sessionTtlSeconds],
  );
  return {
    status: 200,
    json: userBody(toPerson(row)),
    headers: {
      "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}`,
    },
  };
}

async function signOut(ctx: SignedInContext): Promise<Reply> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [ctx.session.tokenHash]);
  return { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
}

export function registerAuthRoutes(): void {
  openRoute("POST", "/api/session", signIn);
  route("DELETE", "/api/session", signOut);
  route("GET", "/api/me", async (ctx) => ({ status: 200, json: userBody(ctx.session.person) }));
}
