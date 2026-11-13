// Sign-in through Keycloak (authorization code + PKCE, state bound to the browser), the app session,
// access renewal, bearer tokens and the role landing routes.
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";
import { BANNERS, SIGN_IN_ERROR } from "../shared/copy.js";
import { config } from "./config.js";
import { one, query } from "./db.js";
import { cookie, fail, noContent, ok, type Reply, type Request, type Router } from "./http.js";
import { ServiceDown, reach } from "./providers/reach.js";
import { claims, grantRole, oidc, realmRoles, tokenGrant, type Role, type TokenSet } from "./keycloak.js";

const SESSION_COOKIE = "sr_session";
const BROWSER_COOKIE = "sr_browser";
const SESSION_DAYS = 30;

export interface Caller {
  id: string;
  email: string;
  name: string;
  roles: Role[];
}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const token = (bytes: number): string => randomBytes(bytes).toString("base64url");

function page(status: number, heading: string, text: string, headers: Record<string, string | string[]> = {}): Reply {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading} — Spindrift Rooms</title><link rel="stylesheet" href="/page.css"></head>
<body><main class="page-message"><a class="wordmark" href="/">Spindrift Rooms</a><h1>${heading}</h1><p>${text}</p>
<p><a class="primary" href="/auth/login">Sign in</a></p></main></body></html>`;
  return { status, bytes: Buffer.from(html), headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } };
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");

function signInError(): Reply {
  return page(400, escapeHtml(SIGN_IN_ERROR.heading), escapeHtml(SIGN_IN_ERROR.text));
}

function keycloakDown(): Reply {
  return page(503, "Sign-in is paused", escapeHtml(BANNERS.keycloak));
}

/** `returnTo` is kept only when it is a path starting with one `/`. */
function safeReturn(value: string | null): string | null {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : null;
}

async function upsertUser(id: string, email: string, name: string): Promise<void> {
  await query(
    `INSERT INTO users (id, email, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
     WHERE users.email IS DISTINCT FROM EXCLUDED.email OR users.name IS DISTINCT FROM EXCLUDED.name`,
    [id, email, name],
  );
}

function identity(tokens: TokenSet): { id: string; email: string; name: string; roles: Role[] } {
  const access = claims(tokens.access_token);
  const id = String(access.sub);
  const email = String(access.email ?? access.preferred_username ?? "");
  const name = String(access.name ?? ([access.given_name, access.family_name].filter(Boolean).join(" ") || email));
  return { id, email, name, roles: realmRoles(access) };
}

/** A signed-in user with none of the four roles gets `client`; the tokens are renewed to carry it. */
async function withDefaultRole(tokens: TokenSet): Promise<TokenSet> {
  if (identity(tokens).roles.length) return tokens;
  await grantRole(identity(tokens).id, "client");
  return (await tokenGrant({ grant_type: "refresh_token", refresh_token: tokens.refresh_token })) ?? tokens;
}

async function storeSession(tokens: TokenSet, idHash: string): Promise<void> {
  const who = identity(tokens);
  await upsertUser(who.id, who.email, who.name);
  await query(
    `INSERT INTO sessions (id_hash, user_id, roles, access_token, refresh_token, id_token, access_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id_hash) DO UPDATE SET roles = EXCLUDED.roles, access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token, id_token = EXCLUDED.id_token, access_expires_at = EXCLUDED.access_expires_at`,
    [idHash, who.id, who.roles, tokens.access_token, tokens.refresh_token, tokens.id_token ?? "", new Date(Date.now() + config.timers.accessTtlSeconds * 1000)],
  );
}

/** Re-reads the caller's realm roles from Keycloak after the app changed them (e.g. sponsor acceptance). */
export async function renewSessionRoles(req: Request): Promise<void> {
  const sid = req.cookies[SESSION_COOKIE];
  if (!sid) return;
  const row = await one<{ refresh_token: string }>("SELECT refresh_token FROM sessions WHERE id_hash = $1", [hash(sid)]);
  const renewed = row && (await tokenGrant({ grant_type: "refresh_token", refresh_token: row.refresh_token }));
  if (renewed) await storeSession(renewed, hash(sid));
}

// ---- Bearer tokens -------------------------------------------------------------------------------

let jwks: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;

async function signingKey(kid: string): Promise<JsonWebKey | null> {
  if (!jwks || Date.now() - jwks.at > 300_000 || !jwks.keys.some((k) => k.kid === kid)) {
    const response = await reach("keycloak", oidc.certs, {}, 5000);
    jwks = { at: Date.now(), keys: ((await response.json()) as { keys: (JsonWebKey & { kid?: string })[] }).keys };
  }
  return jwks.keys.find((k) => k.kid === kid) ?? null;
}

async function bearerCaller(jwt: string): Promise<Caller | null> {
  const [head, body, signature] = jwt.split(".");
  if (!head || !body || !signature) return null;
  let header: { kid?: string; alg?: string };
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8")) as { kid?: string; alg?: string };
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  const jwk = await signingKey(header.kid);
  if (!jwk) return null;
  const valid = verify("RSA-SHA256", Buffer.from(`${head}.${body}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(signature, "base64url"));
  if (!valid) return null;
  const c = claims(jwt);
  if (c.iss !== config.keycloak.issuer || typeof c.exp !== "number" || c.exp * 1000 <= Date.now()) return null;
  if (c.azp !== config.keycloak.clientId && !(Array.isArray(c.aud) ? c.aud : [c.aud]).includes(config.keycloak.clientId)) return null;
  const who = identity({ access_token: jwt, refresh_token: "" });
  await upsertUser(who.id, who.email, who.name);
  if (!who.roles.length) {
    await grantRole(who.id, "client");
    who.roles = ["client"];
  }
  return who;
}

// ---- Callers -------------------------------------------------------------------------------------

/** The caller, or null when the request carries no session or token at all. Lapsed access → 401 session_expired. */
async function currentCaller(req: Request): Promise<Caller | null> {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const caller = await bearerCaller(authorization.slice(7).trim());
    return caller ?? fail(401, "unauthenticated");
  }
  const sid = req.cookies[SESSION_COOKIE];
  if (!sid) return null;
  const row = await one<{ user_id: string; roles: Role[]; access_expires_at: Date; email: string; name: string }>(
    "SELECT s.user_id, s.roles, s.access_expires_at, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = $1",
    [hash(sid)],
  );
  if (!row) return null;
  if (row.access_expires_at.getTime() <= Date.now()) fail(401, "session_expired");
  return { id: row.user_id, email: row.email, name: row.name, roles: row.roles };
}

export async function requireCaller(req: Request): Promise<Caller> {
  return (await currentCaller(req)) ?? fail(401, "unauthenticated");
}

/** Where each role lands after sign-in without `returnTo`. */
async function landing(caller: { id: string; roles: Role[] }): Promise<string> {
  if (caller.roles.includes("producer")) return "/studio";
  if (caller.roles.includes("crew")) return "/crew";
  const ownsCommission = await one("SELECT 1 FROM commissions WHERE client_id = $1 LIMIT 1", [caller.id]);
  const share = await one<{ commission_id: string }>(
    "SELECT commission_id FROM funders WHERE user_id = $1 AND accepted_at IS NOT NULL ORDER BY accepted_at DESC LIMIT 1",
    [caller.id],
  );
  if (share && caller.roles.includes("sponsor") && !ownsCommission) return `/c/${share.commission_id}/share`;
  return "/commissions";
}

// ---- Routes --------------------------------------------------------------------------------------

async function login(req: Request): Promise<Reply> {
  try {
    const discovery = await reach("keycloak", oidc.discovery, {}, 3000);
    if (discovery.status !== 200) return keycloakDown();
  } catch {
    return keycloakDown();
  }
  const state = token(24);
  const nonce = token(24);
  const verifier = token(48);
  const browser = req.cookies[BROWSER_COOKIE] ?? token(32);
  await query("DELETE FROM sign_in_attempts WHERE created_at < now() - interval '1 hour'");
  await query(
    "INSERT INTO sign_in_attempts (state, browser_hash, verifier, nonce, return_to) VALUES ($1, $2, $3, $4, $5)",
    [state, hash(browser), verifier, nonce, safeReturn(req.url.searchParams.get("returnTo"))],
  );
  const target = new URL(oidc.authorize);
  target.search = new URLSearchParams({
    client_id: config.keycloak.clientId,
    response_type: "code",
    scope: "openid",
    redirect_uri: `${config.publicUrl}/auth/callback`,
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { status: 302, headers: { Location: target.href, "Set-Cookie": cookie(BROWSER_COOKIE, browser, 3600), "Cache-Control": "no-store" } };
}

async function callback(req: Request): Promise<Reply> {
  const state = req.url.searchParams.get("state");
  const code = req.url.searchParams.get("code");
  const browser = req.cookies[BROWSER_COOKIE];
  if (!state || !code || !browser) return signInError();
  const attempt = await one<{ verifier: string; nonce: string; return_to: string | null }>(
    `UPDATE sign_in_attempts SET used_at = now()
     WHERE state = $1 AND browser_hash = $2 AND used_at IS NULL AND created_at > now() - interval '15 minutes'
     RETURNING verifier, nonce, return_to`,
    [state, hash(browser)],
  );
  if (!attempt) return signInError();
  let tokens: TokenSet | null;
  try {
    tokens = await tokenGrant({ grant_type: "authorization_code", code, code_verifier: attempt.verifier, redirect_uri: `${config.publicUrl}/auth/callback` });
  } catch (error) {
    if (error instanceof ServiceDown) return keycloakDown();
    throw error;
  }
  if (!tokens?.id_token) return signInError();
  const idClaims = claims(tokens.id_token);
  const expected = Buffer.from(attempt.nonce);
  const given = Buffer.from(String(idClaims.nonce ?? ""));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return signInError();
  tokens = await withDefaultRole(tokens);
  const sid = token(32);
  await storeSession(tokens, hash(sid));
  const destination = attempt.return_to ?? (await landing(identity(tokens)));
  return { status: 302, headers: { Location: destination, "Set-Cookie": cookie(SESSION_COOKIE, sid, SESSION_DAYS * 86400), "Cache-Control": "no-store" } };
}

const clearSession = cookie(SESSION_COOKIE, "", 0);

async function refresh(req: Request): Promise<Reply> {
  const sid = req.cookies[SESSION_COOKIE];
  const row = sid ? await one<{ refresh_token: string }>("SELECT refresh_token FROM sessions WHERE id_hash = $1", [hash(sid)]) : null;
  const renewed = row ? await tokenGrant({ grant_type: "refresh_token", refresh_token: row.refresh_token }).catch(() => null) : null;
  if (!sid || !renewed) {
    if (sid) await query("DELETE FROM sessions WHERE id_hash = $1", [hash(sid)]);
    return { status: 401, body: { error: { code: "signed_out" } }, headers: { "Set-Cookie": clearSession } };
  }
  await storeSession(renewed, hash(sid));
  return noContent();
}

async function logout(req: Request): Promise<Reply> {
  const sid = req.cookies[SESSION_COOKIE];
  if (sid) {
    const row = await one<{ refresh_token: string }>("DELETE FROM sessions WHERE id_hash = $1 RETURNING refresh_token", [hash(sid)]);
    if (row) {
      await reach("keycloak", oidc.logout, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: config.keycloak.clientId, client_secret: config.keycloak.clientSecret, refresh_token: row.refresh_token }).toString(),
      }, 5000).catch(() => undefined);
    }
  }
  return { status: 204, headers: { "Set-Cookie": clearSession } };
}

async function me(req: Request): Promise<Reply> {
  const caller = await requireCaller(req);
  return ok({ id: caller.id, email: caller.email, name: caller.name, roles: caller.roles });
}

export function registerAuth(router: Router): void {
  router.add("GET", "/auth/login", login);
  router.add("GET", "/auth/callback", callback);
  router.add("POST", "/auth/refresh", refresh);
  router.add("POST", "/auth/logout", logout);
  router.add("GET", "/api/me", me);
}
