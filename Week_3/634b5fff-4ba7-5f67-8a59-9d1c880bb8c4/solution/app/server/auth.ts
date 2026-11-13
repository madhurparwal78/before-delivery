import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "../shared/domain.js";
import { pool } from "./db.js";
import { fail } from "./http.js";
import { authorizationUrl, assertReachable, exchangeCode, IdentityUnreachable, verifyAccessToken, type Principal } from "./identity.js";

/** Staff sessions: server-side, created after the Keycloak sign-in, or a verified Keycloak access token as bearer. */

const SESSION_COOKIE = "press_session";
const STATE_COOKIE = "press_oidc";

const cookieOf = (request: FastifyRequest, name: string): string | null => {
  const header = request.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
};

const authenticate = async (request: FastifyRequest): Promise<Principal | null> => {
  const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
  if (bearer) return verifyAccessToken(bearer).catch(() => null);
  const session = cookieOf(request, SESSION_COOKIE);
  if (!session) return null;
  const found = await pool.query("SELECT username, roles FROM sessions WHERE id = $1 AND created_at > now() - interval '8 hours'", [session]);
  const row = found.rows[0] as { username: string; roles: Role[] } | undefined;
  return row ? { username: row.username, roles: row.roles } : null;
};

/** 401 without a sign-in; 403 without the named role, or without any staff role when none is named. */
export const requireStaff = async (request: FastifyRequest, role: Role | "any"): Promise<Principal> => {
  const principal = await authenticate(request);
  if (!principal) return fail("sign_in_required");
  if (role === "any" ? principal.roles.length === 0 : !principal.roles.includes(role)) return fail("forbidden");
  return principal;
};

export const requireSignedIn = async (request: FastifyRequest): Promise<Principal> =>
  (await authenticate(request)) ?? fail("sign_in_required");

const originOf = (request: FastifyRequest): string => `${request.protocol}://${request.headers.host}`;

const cookie = (name: string, value: string, maxAge: number): string =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

export const startLogin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    await assertReachable();
  } catch (error) {
    if (error instanceof IdentityUnreachable) return fail("identity_unreachable");
    throw error;
  }
  const state = randomBytes(16).toString("hex");
  reply.header("set-cookie", cookie(STATE_COOKIE, state, 600));
  reply.redirect(authorizationUrl(`${originOf(request)}/auth/callback`, state), 302);
};

export const finishLogin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const query = request.query as { code?: string; state?: string };
  if (!query.code || !query.state || query.state !== cookieOf(request, STATE_COOKIE)) return fail("sign_in_required");
  let token: string | null;
  try {
    token = await exchangeCode(query.code, `${originOf(request)}/auth/callback`);
  } catch (error) {
    if (error instanceof IdentityUnreachable) return fail("identity_unreachable");
    throw error;
  }
  const principal = token ? await verifyAccessToken(token) : null;
  if (!principal) return fail("sign_in_required");
  const id = randomBytes(24).toString("base64url");
  await pool.query("INSERT INTO sessions (id, username, roles) VALUES ($1, $2, $3)", [id, principal.username, principal.roles]);
  reply.header("set-cookie", [cookie(SESSION_COOKIE, id, 28800), cookie(STATE_COOKIE, "", 0)]);
  reply.redirect("/staff", 302);
};

export const logout = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const session = cookieOf(request, SESSION_COOKIE);
  if (session) await pool.query("DELETE FROM sessions WHERE id = $1", [session]);
  reply.header("set-cookie", cookie(SESSION_COOKIE, "", 0)).code(204).send();
};
