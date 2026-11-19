import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ROLES, type Role } from "../shared/rules.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { forbidden, unauthenticated } from "./errors.js";
import { json, type Ctx, type Reply, type Route } from "./http.js";
import * as keycloak from "./keycloak.js";

// Sessions are signed cookies (no server-side session store): the signed-in person's id, names and
// realm roles, valid for SESSION_SECONDS. The signing key is derived from the client secret.

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  roles: Role[];
}

const SESSION_COOKIE = "py_session";
const LOGIN_COOKIE = "py_login";
const SESSION_SECONDS = 8 * 3600;
const LOGIN_SECONDS = 600;
const KEY = createHmac("sha256", config.keycloak.clientSecret).update("phosphene-yard session v1").digest();

const random = (bytes = 32): string => randomBytes(bytes).toString("base64url");

function seal(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", KEY).update(body).digest("base64url")}`;
}

function open<T extends { exp: number }>(value: string | undefined): T | null {
  const [body, mac] = (value ?? "").split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", KEY).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  return typeof payload.exp === "number" && payload.exp * 1000 > Date.now() ? payload : null;
}

const cookie = (name: string, value: string, maxAge: number, path = "/"): string =>
  `${name}=${value}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${maxAge}`;

const appRoles = (roles: readonly string[] | undefined): Role[] => ROLES.filter((role) => (roles ?? []).includes(role));

function userFromClaims(claims: keycloak.Claims, roles: Role[]): User {
  const username = claims.preferred_username ?? claims.sub;
  const named = [claims.given_name, claims.family_name].filter(Boolean).join(" ");
  return { id: claims.sub, username, displayName: claims.name || named || username, email: claims.email ?? "", roles };
}

/** Keeps the people table (names on cards, invoices and statements) in step with Keycloak. */
async function remember(user: User): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, username, display_name, email) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET username = $2, display_name = $3, email = $4
     WHERE users.username <> $2 OR users.display_name <> $3 OR users.email <> $4`,
    [user.id, user.username, user.displayName, user.email],
  );
}

const resolved = new WeakMap<Ctx, User | null>();

/** The signed-in person from the session cookie or a realm Bearer token, or null. */
export async function currentUser(ctx: Ctx): Promise<User | null> {
  if (resolved.has(ctx)) return resolved.get(ctx) ?? null;
  let user: User | null = null;
  const header = ctx.req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const claims = await keycloak.verifyAccessToken(header.slice(7).trim());
    if (claims) user = userFromClaims(claims, appRoles(claims.realm_access?.roles));
  } else {
    const session = open<User & { exp: number }>(ctx.cookies[SESSION_COOKIE]);
    if (session) user = { id: session.id, username: session.username, displayName: session.displayName, email: session.email, roles: session.roles };
  }
  if (user) await remember(user);
  resolved.set(ctx, user);
  return user;
}

/** Step 2 of the precedence: 401 without a session or token. */
export async function signedIn(ctx: Ctx): Promise<User> {
  const user = await currentUser(ctx);
  if (!user) throw unauthenticated();
  return user;
}

/** Step 4 of the precedence: 403 without the role. */
export function requireRole(user: User, role: Role): void {
  if (!user.roles.includes(role)) throw forbidden();
}

/** A same-site path to come back to after sign-in. */
function safeReturn(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

async function login(ctx: Ctx): Promise<Reply> {
  const state = random();
  const nonce = random();
  const verifier = random(48);
  const target = new URL(keycloak.AUTHORIZE_URL);
  target.search = new URLSearchParams({
    client_id: config.keycloak.clientId,
    response_type: "code",
    scope: "openid profile email",
    redirect_uri: `${config.publicUrl}/auth/callback`,
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  const attempt = seal({ state, nonce, verifier, returnTo: safeReturn(ctx.query.get("return_to")), exp: Math.floor(Date.now() / 1000) + LOGIN_SECONDS });
  return {
    status: 302,
    headers: { Location: target.toString(), "Set-Cookie": cookie(LOGIN_COOKIE, attempt, LOGIN_SECONDS, "/auth"), "Cache-Control": "no-store" },
  };
}

interface LoginAttempt {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

/** Accepted once per attempt cookie and state; a self-registered person gets creator and collector on first sign-in. */
async function callback(ctx: Ctx): Promise<Reply> {
  const attempt = open<LoginAttempt>(ctx.cookies[LOGIN_COOKIE]);
  const code = ctx.query.get("code");
  const failed: Reply = { status: 302, headers: { Location: "/?signin=failed", "Set-Cookie": cookie(LOGIN_COOKIE, "", 0, "/auth") } };
  if (!attempt || !code || ctx.query.get("state") !== attempt.state) return failed;
  const tokens = await keycloak.exchangeCode(code, attempt.verifier);
  if (!tokens?.id_token || keycloak.idTokenNonce(tokens.id_token) !== attempt.nonce) return failed;
  const claims = await keycloak.verifyAccessToken(tokens.access_token);
  if (!claims) return failed;
  let roles = appRoles(claims.realm_access?.roles);
  if (roles.length === 0) {
    roles = ["creator", "collector"];
    await keycloak.grantRealmRoles(claims.sub, roles);
  }
  const user = userFromClaims(claims, roles);
  await remember(user);
  const session = seal({ ...user, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS });
  return {
    status: 302,
    headers: {
      Location: attempt.returnTo,
      "Set-Cookie": [cookie(SESSION_COOKIE, session, SESSION_SECONDS), cookie(LOGIN_COOKIE, "", 0, "/auth")],
      "Cache-Control": "no-store",
    },
  };
}

async function logout(): Promise<Reply> {
  return { status: 204, headers: { "Set-Cookie": cookie(SESSION_COOKIE, "", 0) } };
}

async function me(ctx: Ctx): Promise<Reply> {
  const user = await signedIn(ctx);
  return json(200, { id: user.id, username: user.username, display_name: user.displayName, email: user.email, roles: user.roles });
}

export const authRoutes: Route[] = [
  { method: "GET", pattern: "/auth/login", handler: login },
  { method: "GET", pattern: "/auth/callback", handler: callback },
  { method: "POST", pattern: "/auth/logout", handler: logout },
  { method: "GET", pattern: "/api/me", handler: me },
];
