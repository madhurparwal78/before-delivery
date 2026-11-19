// Keycloak: browser sign-in (authorization code + PKCE), the one-time-code step-up level,
// and the admin API reached through the app's own service account. Server-side only.

import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { serviceUnavailable } from "./errors.js";

const kc = config.keycloak;
const realmPath = `/realms/${encodeURIComponent(kc.realm)}`;
const adminBase = `${kc.url}/admin${realmPath}`;
/** The ACR names the realm maps to authentication levels 1 and 2. */
export const ACR = { password: "password", otp: "otp" } as const;

function timeout(): AbortSignal {
  return AbortSignal.timeout(config.limits.FLAN_PROVIDER_TIMEOUT_MS);
}

async function send(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: "manual", signal: timeout() });
  } catch {
    throw serviceUnavailable();
  }
}

let cachedToken: { value: string; until: number } | null = null;

async function adminToken(): Promise<string> {
  if (cachedToken && cachedToken.until > Date.now()) return cachedToken.value;
  const reply = await send(`${kc.url}${realmPath}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: kc.clientId, client_secret: kc.clientSecret }),
  });
  if (!reply.ok) throw serviceUnavailable();
  const token = (await reply.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: token.access_token, until: Date.now() + (token.expires_in - 20) * 1000 };
  return token.access_token;
}

/** One admin API call; a 401 refreshes the service-account token once. */
export async function admin(method: string, path: string, body?: unknown): Promise<Response> {
  const attempt = async () =>
    send(`${adminBase}${path}`, {
      method,
      headers: { authorization: `Bearer ${await adminToken()}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let reply = await attempt();
  if (reply.status === 401) {
    cachedToken = null;
    reply = await attempt();
  }
  return reply;
}

export async function adminJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const reply = await admin(method, path, body);
  if (!reply.ok) throw serviceUnavailable();
  return (await reply.json()) as T;
}

export async function reachable(): Promise<boolean> {
  try {
    const reply = await send(`${kc.url}${realmPath}/.well-known/openid-configuration`);
    await reply.arrayBuffer();
    return reply.ok;
  } catch {
    return false;
  }
}

// --- browser sign-in ----------------------------------------------------------------------

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

const redirectUri = `${config.publicUrl}/auth/callback`;

export function authorizeUrl(state: string, challenge: string, acr: string): string {
  const query = new URLSearchParams({
    client_id: kc.clientId,
    response_type: "code",
    scope: "openid",
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    acr_values: acr,
  });
  return `${kc.issuerUrl}/protocol/openid-connect/auth?${query}`;
}

interface SignedIn {
  subject: string;
  username: string;
  keycloakSession: string;
  acr: string;
  authTime: number;
  issuedAt: number;
  roles: string[];
}

function claims(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Exchanges an authorization code on the back channel (client-authenticated, so the tokens are trusted). */
export async function exchangeCode(code: string, verifier: string): Promise<SignedIn> {
  const reply = await send(`${kc.url}${realmPath}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: kc.clientId,
      client_secret: kc.clientSecret,
      code_verifier: verifier,
    }),
  });
  if (!reply.ok) throw serviceUnavailable();
  const tokens = (await reply.json()) as { id_token: string; access_token: string };
  const id = claims(tokens.id_token);
  const access = claims(tokens.access_token);
  const realmAccess = access.realm_access as { roles?: string[] } | undefined;
  return {
    subject: String(id.sub),
    username: String(id.preferred_username),
    keycloakSession: String(id.sid ?? ""),
    acr: String(id.acr ?? ""),
    authTime: Number(id.auth_time ?? id.iat),
    issuedAt: Number(id.iat),
    roles: realmAccess?.roles ?? [],
  };
}

// --- users ----------------------------------------------------------------------------------

interface KeycloakUser {
  id: string;
  username: string;
  enabled: boolean;
  attributes?: Record<string, string[]>;
}

export async function findUser(username: string): Promise<KeycloakUser | null> {
  const found = await adminJson<KeycloakUser[]>("GET", `/users?exact=true&username=${encodeURIComponent(username)}`);
  return found[0] ?? null;
}

async function getUser(id: string): Promise<KeycloakUser | null> {
  const reply = await admin("GET", `/users/${id}`);
  if (reply.status === 404) return null;
  if (!reply.ok) throw serviceUnavailable();
  return (await reply.json()) as KeycloakUser;
}

/** True while the account is enabled and the given Keycloak session is still active. */
export async function accountActive(userId: string, keycloakSession: string): Promise<boolean> {
  const user = await getUser(userId);
  if (!user?.enabled) return false;
  const sessions = await adminJson<{ id: string }[]>("GET", `/users/${userId}/sessions`);
  return sessions.some((s) => s.id === keycloakSession);
}

export async function endSessions(userId: string): Promise<void> {
  const reply = await admin("POST", `/users/${userId}/logout`);
  if (!reply.ok) throw serviceUnavailable();
}

export async function disableUser(userId: string): Promise<void> {
  const reply = await admin("PUT", `/users/${userId}`, { enabled: false });
  if (!reply.ok) throw serviceUnavailable();
}

export async function setPassword(userId: string, password: string): Promise<void> {
  const reply = await admin("PUT", `/users/${userId}/reset-password`, { type: "password", value: password, temporary: false });
  if (!reply.ok) throw serviceUnavailable();
}

// --- scripted sign-in used by the grading seed ------------------------------------------------

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "None" | "Strict";
}

function parseSetCookie(header: string, host: string): BrowserCookie {
  const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
  const eq = pair.indexOf("=");
  const cookie: BrowserCookie = {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    domain: host,
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  };
  for (const attribute of attributes) {
    const [rawName = "", ...rest] = attribute.split("=");
    const name = rawName.toLowerCase();
    const value = rest.join("=");
    if (name === "path") cookie.path = value || "/";
    else if (name === "max-age") cookie.expires = Number(value) > 0 ? Math.floor(Date.now() / 1000) + Number(value) : 0;
    else if (name === "expires" && cookie.expires === -1) cookie.expires = Math.floor(Date.parse(value) / 1000);
    else if (name === "httponly") cookie.httpOnly = true;
    else if (name === "secure") cookie.secure = true;
    else if (name === "samesite") cookie.sameSite = value.toLowerCase() === "strict" ? "Strict" : value.toLowerCase() === "none" ? "None" : "Lax";
  }
  // Without Secure a browser refuses SameSite=None, so the cookie behaves as Lax over plain HTTP.
  if (cookie.sameSite === "None" && !cookie.secure) cookie.sameSite = "Lax";
  return cookie;
}

/**
 * Signs a seeded identity in through Keycloak's own login form, exactly as a browser does,
 * and returns the Keycloak cookies plus the authorization code for the app's callback.
 */
export async function passwordSignIn(
  username: string,
  password: string,
  state: string,
  challenge: string,
): Promise<{ cookies: BrowserCookie[]; code: string }> {
  const host = new URL(kc.issuerUrl).hostname;
  const jar = new Map<string, BrowserCookie>();
  const keep = (reply: Response) => {
    for (const header of reply.headers.getSetCookie()) {
      const cookie = parseSetCookie(header, host);
      if (cookie.expires === 0) jar.delete(cookie.name);
      else jar.set(cookie.name, cookie);
    }
  };
  const cookieHeader = () => [...jar.values()].map((c) => `${c.name}=${c.value}`).join("; ");
  const page = await send(authorizeUrl(state, challenge, ACR.password));
  keep(page);
  const html = await page.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
  if (!action) throw serviceUnavailable();
  const posted = await send(action.replaceAll("&amp;", "&"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
    body: new URLSearchParams({ username, password, credentialId: "" }),
  });
  keep(posted);
  await posted.arrayBuffer();
  const location = posted.headers.get("location");
  const code = location ? new URL(location).searchParams.get("code") : null;
  if (posted.status !== 302 || !code) throw serviceUnavailable();
  return { cookies: [...jar.values()], code };
}
